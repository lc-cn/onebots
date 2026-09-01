import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
    DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES,
    HttpRouteConflictError,
    Router,
    WebSocketRouteConflictError,
} from "./router.js";

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
    it("账号作用域关闭时撤销 HTTP、WebSocket 与迟到注册", async () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server);
        router.get("/shared", ctx => {
            ctx.body = "shared";
        });
        const scope = router.createRegistrationScope();
        let release!: () => void;
        const pending = scope.run(async () => {
            router.get("/owned", ctx => {
                ctx.body = "owned";
            });
            router.ws("/owned/events");
            await new Promise<void>(resolve => (release = resolve));
            router.post("/late", ctx => {
                ctx.body = "late";
            });
            router.ws("/late/events");
        });
        await Promise.resolve();

        expect(router.stack.map(layer => layer.path)).toEqual(["/shared", "/owned"]);
        expect(router.getWsPaths()).toEqual(["/owned/events"]);
        scope.close();
        expect(router.stack.map(layer => layer.path)).toEqual(["/shared"]);
        expect(router.getWsPaths()).toEqual([]);

        release();
        await pending;
        expect(router.stack.map(layer => layer.path)).toEqual(["/shared"]);
        expect(router.getWsPaths()).toEqual([]);
    });

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

    it("保留既有默认载荷上限并拒绝无效的路由上限", () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server);

        expect(router.ws("/default").options.maxPayload).toBe(DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES);
        expect(router.ws("/limited", { maxPayloadBytes: 1024 }).options.maxPayload).toBe(1024);
        expect(() => router.ws("/zero", { maxPayloadBytes: 0 })).toThrow("1 到 100 MiB");
        expect(() =>
            router.ws("/too-large", {
                maxPayloadBytes: DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES + 1,
            }),
        ).toThrow("1 到 100 MiB");
        expect(router.getWsPaths()).toEqual(["/default", "/limited"]);
    });

    it("单条入站消息超过路由上限时以 1009 关闭连接", async () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server);
        router.ws("/limited", { maxPayloadBytes: 8 });

        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("测试服务器未监听 TCP");

        const client = new WebSocket(`ws://127.0.0.1:${address.port}/limited`);
        await once(client, "open");
        const closed = once(client, "close");
        client.send(Buffer.alloc(9));

        const [code] = await closed;
        expect(code).toBe(1009);
        await router.cleanupAsync();
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

describe("Router HTTP route registration", () => {
    it("拒绝完全相同的方法与路径，并回滚新增 Layer", () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server);
        router.get("/callback", ctx => {
            ctx.body = "first";
        });

        expect(() =>
            router.get("/callback", ctx => {
                ctx.body = "second";
            }),
        ).toThrowError(
            expect.objectContaining({
                name: "HttpRouteConflictError",
                path: "/callback",
                methods: ["GET", "HEAD"],
            }),
        );
        expect(router.stack).toHaveLength(1);
    });

    it("允许同一路径注册不同方法", () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server);

        router.get("/callback", () => undefined);
        router.post("/callback", () => undefined);

        expect(router.stack).toHaveLength(2);
    });

    it("数组路径中的任一路径冲突时原子回滚整次注册", () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server, { prefix: "/gateway" });
        router.get("/existing", () => undefined);

        expect(() => router.get(["/new", "/existing"], () => undefined)).toThrow(
            new HttpRouteConflictError("/gateway/existing", ["GET", "HEAD"]),
        );
        expect(router.stack.map(layer => layer.path)).toEqual(["/gateway/existing"]);
    });

    it("报告冲突路由的注册账号与现有账号", () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server);
        const existing = router.createRegistrationScope({
            platform: "wechat",
            account_id: "official",
        });
        existing.run(() => router.post("/callback", () => undefined));
        const registering = router.createRegistrationScope({
            platform: "wecom",
            account_id: "corp",
        });

        let conflict: unknown;
        try {
            registering.run(() => router.post("/callback", () => undefined));
        } catch (error) {
            conflict = error;
        }

        expect(conflict).toBeInstanceOf(HttpRouteConflictError);
        expect(conflict).toMatchObject({
            registeringOwner: { platform: "wecom", account_id: "corp" },
            existingOwner: { platform: "wechat", account_id: "official" },
        });
        expect((conflict as Error).message).toContain(
            "账号 wecom/corp 无法注册（现有注册者：账号 wechat/official）",
        );
        expect(router.stack).toHaveLength(1);
    });

    it("报告冲突 WebSocket 路径的注册账号与现有账号", () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server);
        const existing = router.createRegistrationScope({
            platform: "wechat",
            account_id: "official",
        });
        existing.run(() => router.ws("/events"));
        const registering = router.createRegistrationScope({
            platform: "wecom",
            account_id: "corp",
        });

        let conflict: unknown;
        try {
            registering.run(() => router.ws("/events"));
        } catch (error) {
            conflict = error;
        }

        expect(conflict).toBeInstanceOf(WebSocketRouteConflictError);
        expect(conflict).toMatchObject({
            path: "/events",
            registeringOwner: { platform: "wecom", account_id: "corp" },
            existingOwner: { platform: "wechat", account_id: "official" },
        });
        expect((conflict as Error).message).toContain(
            "账号 wecom/corp 无法注册（现有注册者：账号 wechat/official）",
        );
        expect(router.getWsPaths()).toEqual(["/events"]);
    });

    it("区分适配器全局路由与账号路由的冲突归属", () => {
        const server = createServer();
        servers.add(server);
        const router = new Router(server);
        const adapter = router.createRegistrationScope({ platform: "wechat" });
        adapter.run(() => router.post("/callback", () => undefined));
        const account = router.createRegistrationScope({
            platform: "wechat",
            account_id: "official",
        });

        expect(() => account.run(() => router.post("/callback", () => undefined))).toThrow(
            "账号 wechat/official 无法注册（现有注册者：适配器 wechat）",
        );
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
