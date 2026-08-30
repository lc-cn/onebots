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
});
