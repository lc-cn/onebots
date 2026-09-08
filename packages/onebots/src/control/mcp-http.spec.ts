import fs from "node:fs";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlAuth } from "./auth.js";
import { ControlMcpService } from "./mcp-api.js";
import { respondControlMcp } from "./mcp-http.js";
import type { GatewayMcpRequest, GatewayMcpResult } from "../gateway/mcp-contracts.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync("/tmp/mcp-http-");
    roots.push(root);
    const auth = new ControlAuth({ statePath: path.join(root, "auth.json") });
    const token = auth.pair(auth.issueBootstrap());
    const gateway = randomUUID();
    const forward = vi.fn(
        async (_gateway: string, _request: GatewayMcpRequest): Promise<GatewayMcpResult> => ({}),
    );
    const service = new ControlMcpService({ currentGateway: () => gateway, forward });
    const revoke = vi.spyOn(service, "revokeOwner");
    const request = new IncomingMessage(new Socket());
    request.method = "POST";
    request.headers.authorization = `Bearer ${token}`;
    const response = new ServerResponse(request);
    let body = "";
    vi.spyOn(response, "end").mockImplementation((chunk?: unknown) => {
        body = String(chunk);
        return response;
    });
    return { auth, token, service, forward, revoke, request, response, body: () => body };
}
describe("MCP HTTP authentication boundary", () => {
    it("does not forward if authentication is revoked while body is still arriving", async () => {
        const f = fixture();
        const work = respondControlMcp(
            f.service,
            f.request,
            f.response,
            "/api/control/mcp/open",
            false,
            f.auth,
        );
        f.request.push('{"account":');
        await new Promise(resolve => setImmediate(resolve));
        f.auth.revoke(f.token);
        f.request.push('"mock/bot"}');
        f.request.push(null);
        expect(await work).toBe(true);
        expect(f.response.statusCode).toBe(401);
        expect(f.forward).not.toHaveBeenCalled();
        expect(f.revoke).toHaveBeenCalledWith(createHash("sha256").update(f.token).digest("hex"));
        expect(f.body()).not.toContain(f.token);
    });
    it("withholds a late account result and revokes the owner after in-flight revocation", async () => {
        const f = fixture();
        const opened = await f.service.handle({
            pathname: "/api/control/mcp/open",
            method: "POST",
            owner: createHash("sha256").update(f.token).digest("hex"),
            body: async () => ({}),
        });
        const id = (opened!.body as { id: string }).id;
        let complete!: (result: GatewayMcpResult) => void;
        f.forward.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    complete = resolve;
                }),
        );
        const work = respondControlMcp(
            f.service,
            f.request,
            f.response,
            "/api/control/mcp/exchange",
            false,
            f.auth,
        );
        f.request.push(
            JSON.stringify({ id, message: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }),
        );
        f.request.push(null);
        await new Promise(resolve => setImmediate(resolve));
        f.auth.revoke(f.token);
        complete({ message: '{"jsonrpc":"2.0","id":1,"result":"private-account-value"}' });
        await work;
        expect(f.response.statusCode).toBe(401);
        expect(f.body()).not.toContain("private-account-value");
        expect(f.revoke).toHaveBeenCalledTimes(1);
        const after = await f.service.handle({
            pathname: "/api/control/mcp/poll",
            method: "POST",
            owner: createHash("sha256").update(f.token).digest("hex"),
            body: async () => ({ id }),
        });
        expect(after?.status).toBe(404);
    });
    it("local calls require no auth and never send a bearer token to the gateway", async () => {
        const f = fixture();
        const work = respondControlMcp(
            f.service,
            f.request,
            f.response,
            "/api/control/mcp/open",
            true,
        );
        f.request.push("{}");
        f.request.push(null);
        await work;
        expect(f.response.statusCode).toBe(200);
        expect(f.revoke).not.toHaveBeenCalled();
        expect(f.forward).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(f.forward.mock.calls)).not.toContain(f.token);
        expect(f.forward.mock.calls[0][1]).toMatchObject({ action: "open" });
        expect(Object.keys(f.forward.mock.calls[0][1])).toEqual(["action", "sessionId"]);
    });
    it("ignores unrelated paths without reading a body", async () => {
        const f = fixture();
        expect(
            await respondControlMcp(f.service, f.request, f.response, "/other", false, f.auth),
        ).toBe(false);
        expect(f.forward).not.toHaveBeenCalled();
    });
});
