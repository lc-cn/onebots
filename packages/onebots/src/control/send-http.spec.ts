import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlSendRequest } from "@onebots/core/control";
import { ControlAuth } from "./auth.js";
import { ControlSendService } from "./send-service.js";
import { respondControlSend } from "./send-http.js";

const roots: string[] = [];
const services: ControlSendService[] = [];
afterEach(async () => {
    await Promise.all(services.splice(0).map(service => service.close()));
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "send-http-"));
    roots.push(root);
    const auth = new ControlAuth({ statePath: path.join(root, "auth.json") });
    const token = auth.pair(auth.issueBootstrap());
    const context = { gatewayInstanceId: randomUUID(), configVersion: "a".repeat(64) };
    const directory = path.join(root, "operations");
    const forward = vi.fn(async (_request: ControlSendRequest) => ({
        messageId: "private-result",
    }));
    const options = { directory, currentContext: () => context, forward };
    const service = new ControlSendService(options);
    services.push(service);
    const input: ControlSendRequest = {
        id: randomUUID(),
        expected: context,
        account: "mock/bot",
        targetType: "private",
        targetId: "007",
        message: "synthetic-private-message",
    };
    return { root, auth, token, service, forward, options, input };
}
function http(method: string, token?: string, url = "/api/control/messages/send") {
    const request = new IncomingMessage(new Socket());
    request.method = method;
    request.url = url;
    if (token) request.headers.authorization = `Bearer ${token}`;
    const response = new ServerResponse(request);
    let body = "";
    vi.spyOn(response, "end").mockImplementation((chunk?: unknown) => {
        body = String(chunk);
        return response;
    });
    return { request, response, body: () => body };
}
async function call(
    f: ReturnType<typeof fixture>,
    method: string,
    pathname: string,
    options: {
        local?: boolean;
        token?: string;
        auth?: ControlAuth;
        body?: unknown;
        query?: string;
    } = {},
) {
    const h = http(method, options.token, pathname + (options.query ?? ""));
    const work = respondControlSend(
        f.service,
        h.request,
        h.response,
        pathname,
        options.local ?? false,
        options.auth ?? f.auth,
    );
    if (options.body !== undefined) h.request.push(JSON.stringify(options.body));
    h.request.push(null);
    expect(await work).toBe(true);
    return h;
}

describe("send HTTP authentication and local recovery boundary", () => {
    it("does not dispatch or persist an intent when the token is revoked during body read", async () => {
        const f = fixture();
        const h = http("POST", f.token);
        const work = respondControlSend(
            f.service,
            h.request,
            h.response,
            "/api/control/messages/send",
            false,
            f.auth,
        );
        const body = JSON.stringify(f.input);
        h.request.push(body.slice(0, 30));
        await new Promise(resolve => setImmediate(resolve));
        f.auth.revoke(f.token);
        h.request.push(body.slice(30));
        h.request.push(null);
        await work;
        expect(h.response.statusCode).toBe(401);
        expect(h.body()).toBe(JSON.stringify({ message: "控制认证失败" }));
        expect(f.forward).not.toHaveBeenCalled();
        expect(() => f.service.operation(hash(f.token), f.input.id)).toThrow(
            expect.objectContaining({ httpStatus: 404 }),
        );
    });

    it("withholds an in-flight result after revocation but durably preserves it for local read-only recovery", async () => {
        const f = fixture();
        let complete!: (value: { messageId: string }) => void;
        f.forward.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    complete = resolve;
                }),
        );
        const h = http("POST", f.token);
        const work = respondControlSend(
            f.service,
            h.request,
            h.response,
            "/api/control/messages/send",
            false,
            f.auth,
        );
        h.request.push(JSON.stringify(f.input));
        h.request.push(null);
        await new Promise(resolve => setImmediate(resolve));
        expect(f.forward).toHaveBeenCalledTimes(1);
        expect(f.service.operation(hash(f.token), f.input.id).status).toBe("running");
        f.auth.revoke(f.token);
        complete({ messageId: "private-result" });
        await work;
        expect(h.response.statusCode).toBe(401);
        expect(h.body()).not.toContain("private-result");
        expect(h.body()).not.toContain(f.input.message);
        expect(JSON.stringify(f.forward.mock.calls)).not.toContain(f.token);
        await f.service.close();
        const restored = new ControlSendService(f.options);
        services.push(restored);
        const reloaded = { ...f, service: restored };
        const route = `/api/control/messages/operations/${f.input.id}`;
        const revoked = await call(reloaded, "GET", route, { token: f.token });
        expect(revoked.response.statusCode).toBe(401);
        expect(revoked.body()).not.toContain("private-result");
        const local = await call(reloaded, "GET", route, { local: true });
        expect(local.response.statusCode).toBe(200);
        expect(JSON.parse(local.body())).toMatchObject({
            id: f.input.id,
            status: "succeeded",
            messageId: "private-result",
        });
        expect(local.body()).not.toContain(hash(f.token));
        expect(local.body()).not.toContain(f.input.message);
        expect(() => restored.operation(hash("local"), f.input.id)).toThrow(
            expect.objectContaining({ httpStatus: 404 }),
        );
        expect(restored.operation(hash(f.token), f.input.id).status).toBe("succeeded");
        const resend = await call(reloaded, "POST", "/api/control/messages/send", {
            local: true,
            body: f.input,
        });
        expect(resend.response.statusCode).toBe(404);
        expect(f.forward).toHaveBeenCalledTimes(1);
    });

    it.each(["query", "body"])(
        "does not grant remote cross-owner recovery from %s local=true",
        async source => {
            const f = fixture();
            await f.service.send(hash(f.token), f.input);
            // Another authenticated credential has its own owner; transport alone decides local authority.
            const otherAuth = new ControlAuth({ statePath: path.join(f.root, "other-auth.json") });
            const otherToken = otherAuth.pair(otherAuth.issueBootstrap());
            const response = await call(
                f,
                "GET",
                `/api/control/messages/operations/${f.input.id}`,
                {
                    token: otherToken,
                    auth: otherAuth,
                    ...(source === "query" ? { query: "?local=true" } : { body: { local: true } }),
                },
            );
            expect(response.response.statusCode).toBe(404);
            expect(response.body()).not.toContain("private-result");
            expect(response.body()).not.toContain(f.input.id);
            expect(f.service.operation(hash(f.token), f.input.id).status).toBe("succeeded");
            expect(f.forward).toHaveBeenCalledTimes(1);
        },
    );

    it("rejects a remote send body attempting to claim local authority", async () => {
        const f = fixture();
        const h = await call(f, "POST", "/api/control/messages/send", {
            token: f.token,
            body: { ...f.input, local: true },
        });
        expect(h.response.statusCode).toBe(400);
        expect(f.forward).not.toHaveBeenCalled();
    });
});
