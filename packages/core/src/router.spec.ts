import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Router } from "./router.js";

const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
    await Promise.all(
        [...servers].map(
            server =>
                new Promise<void>(resolve => {
                    server.close(() => resolve());
                }),
        ),
    );
    servers.clear();
});

describe("Router WebSocket lifecycle", () => {
    it("使用独立于 Koa prefix 的规范 pathname", () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server, { prefix: "/api" });

        expect(router.ws("events").path).toBe("/events");
        expect(router.getWsPaths()).toEqual(["/events"]);
        expect(router.removeWs("/events")).toBe(true);
        expect(router.getWsPaths()).toEqual([]);
        expect(() => router.ws("//example.com/events")).toThrow("绝对 pathname");
    });

    it("cleanupAsync 会先终止活跃客户端并移除 upgrade 监听器", async () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server);
        const wsServer = router.ws("/events");
        const connected = new Promise<void>(resolve =>
            wsServer.once("connection", () => resolve()),
        );

        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("测试服务器未监听 TCP");

        const client = new WebSocket(`ws://127.0.0.1:${address.port}/events`);
        await Promise.all([once(client, "open"), connected]);
        const closed = once(client, "close");

        await router.cleanupAsync();
        await closed;

        expect(router.getWsPaths()).toEqual([]);
        expect(server.listenerCount("upgrade")).toBe(0);
        expect(client.readyState).toBe(WebSocket.CLOSED);
    });

    it("在握手前拒绝未授权 WebSocket，并允许通过授权的请求", async () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server);
        const wsServer = router.ws("/protected", {
            authorize: request => request.headers.authorization === "Bearer secret",
        });
        let connections = 0;
        wsServer.on("connection", () => connections++);

        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("测试服务器未监听 TCP");
        const url = `ws://127.0.0.1:${address.port}/protected`;

        await expect(rejectedUpgradeStatus(url)).resolves.toEqual({
            status: 401,
            authenticate: "Bearer",
        });
        expect(connections).toBe(0);

        const authorized = new WebSocket(url, {
            headers: { Authorization: "Bearer secret" },
        });
        await once(authorized, "open");
        expect(connections).toBe(1);
        authorized.close();
        await once(authorized, "close");
        await router.cleanupAsync();
    });
});

function rejectedUpgradeStatus(
    url: string,
): Promise<{ status: number | undefined; authenticate: string | undefined }> {
    return new Promise((resolve, reject) => {
        const client = new WebSocket(url);
        client.once("unexpected-response", (_request, response) => {
            const result = {
                status: response.statusCode,
                authenticate: response.headers["www-authenticate"],
            };
            response.resume();
            resolve(result);
        });
        client.once("open", () => reject(new Error("未授权 WebSocket 意外完成握手")));
        client.once("error", () => undefined);
    });
}
