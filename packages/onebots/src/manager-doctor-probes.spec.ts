import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlDiagnostics } from "@onebots/core/control";
import { probeManagerWeb } from "./manager-doctor-probes.js";

const servers: http.Server[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
        servers.splice(0).map(
            server =>
                new Promise<void>((resolve, reject) => {
                    server.close(error => (error ? reject(error) : resolve()));
                    server.closeAllConnections();
                }),
        ),
    );
});
function state(port: number): ControlDiagnostics {
    return {
        schemaVersion: 1,
        manager: { id: "11111111-1111-4111-8111-111111111111", pid: 1, version: "1.0.0" },
        management: { host: "127.0.0.1", port },
        gateway: { actual: "stopped", desired: "stopped", recoveryRequired: false },
        configuration: { state: "ready", recoveryRequired: false },
        generation: { activeId: null, recoveryRequired: false },
        storage: {
            dataDirectory: "creatable",
            database: "creatable",
            publicStatic: "disabled",
            databaseIntegrity: "not-checked",
        },
        extensions: { receipt: "bundled", selection: "ready", registration: "not-checked" },
        processOwnership: { available: true },
        serviceMigration: { pending: false, recoveryRequired: false },
    };
}
async function server(handler: http.RequestListener) {
    const instance = http.createServer(handler);
    servers.push(instance);
    await new Promise<void>((resolve, reject) => {
        instance.once("error", reject);
        instance.listen(0, "127.0.0.1", resolve);
    });
    return state((instance.address() as AddressInfo).port);
}
function normal(request: http.IncomingMessage, response: http.ServerResponse) {
    if (["/healthz", "/ready"].includes(request.url!)) {
        response.setHeader("Content-Type", "application/json");
        response.end(
            JSON.stringify({
                application: "onebots",
                instance_id: state(1).manager.id,
                ready: true,
            }),
        );
    } else if (request.url === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end("<html><body>OneBots</body></html>");
    } else {
        response.statusCode = 401;
        response.end("unauthorized");
    }
}
describe("manager doctor 本机 Web 探针", () => {
    it("真实服务收到4个GET，不发送Cookie或Authorization", async () => {
        const requests: Array<{
            method?: string;
            url?: string;
            cookie?: string;
            authorization?: string;
        }> = [];
        const input = await server((request, response) => {
            requests.push({
                method: request.method,
                url: request.url,
                cookie: request.headers.cookie,
                authorization: request.headers.authorization,
            });
            normal(request, response);
        });
        const checks = await probeManagerWeb(input);
        expect(checks.map(check => check.status)).toEqual(["pass", "pass", "pass", "pass"]);
        expect(requests).toEqual(
            ["/healthz", "/ready", "/", "/api/control/status"].map(url => ({
                method: "GET",
                url,
                cookie: undefined,
                authorization: undefined,
            })),
        );
    });
    it.each(["/healthz", "/ready"])("%s 实例不匹配时不继续", async target => {
        const routes: string[] = [];
        const input = await server((request, response) => {
            routes.push(request.url!);
            if (request.url === target)
                response.end(
                    JSON.stringify({ application: "onebots", instance_id: "foreign", ready: true }),
                );
            else normal(request, response);
        });
        const checks = await probeManagerWeb(input);
        expect(checks.at(-1)?.status).toBe("fail");
        expect(routes).toEqual(target === "/healthz" ? [target] : ["/healthz", target]);
    });
    it("匿名管理接口错误放行被报告失败", async () => {
        const input = await server((request, response) => {
            if (request.url === "/api/control/status") {
                response.statusCode = 200;
                response.end("synthetic-secret");
            } else normal(request, response);
        });
        const checks = await probeManagerWeb(input);
        expect(checks.at(-1)).toMatchObject({ id: "anonymous-access", status: "fail" });
        expect(JSON.stringify(checks)).not.toContain("synthetic-secret");
    });
    it("重定向不跟随且停止身份探测", async () => {
        const routes: string[] = [];
        const input = await server((request, response) => {
            routes.push(request.url!);
            response.writeHead(302, { Location: "/redirect-target" });
            response.end();
        });
        expect((await probeManagerWeb(input))[0].status).toBe("fail");
        expect(routes).toEqual(["/healthz"]);
    });
    it("超大响应拒绝，不回显内容也不继续", async () => {
        const routes: string[] = [];
        const input = await server((request, response) => {
            routes.push(request.url!);
            response.end("synthetic-secret".repeat(10_000));
        });
        const checks = await probeManagerWeb(input);
        expect(checks).toHaveLength(1);
        expect(checks[0].status).toBe("fail");
        expect(JSON.stringify(checks)).not.toContain("synthetic-secret");
        expect(routes).toEqual(["/healthz"]);
    });
    it("非本机IP不调用fetch", async () => {
        const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
            throw new Error("must not fetch");
        });
        const input = state(6727);
        input.management = { host: "192.0.2.123", port: 6727 };
        expect((await probeManagerWeb(input))[0]).toMatchObject({ status: "fail" });
        expect(fetcher).not.toHaveBeenCalled();
    });
});
