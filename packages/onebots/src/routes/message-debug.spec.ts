import type { Router, RouterContext } from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import type { App } from "../app.js";
import { MessageDebugManager } from "../message-debug.js";
import { MANAGEMENT_EXPECTED_INSTANCE_HEADER } from "../management-instance-precondition.js";
import { registerMessageDebugRoutes } from "./message-debug.js";

type RouteHandler = (ctx: RouterContext) => void | Promise<void>;

function setup() {
    const gets = new Map<string, RouteHandler>();
    const posts = new Map<string, RouteHandler>();
    const messageDebug = new MessageDebugManager();
    messageDebug.recordInbound("mock", "demo", { text: "first" });
    messageDebug.recordOutbound("mock", "demo", "onebot", "v11", { text: "second" });
    const app = {
        info: {
            application_name: "onebots",
            application_version: "1.2.8",
            instance_id: "instance-a",
        },
        runtimeContractId: "sha256:contract-a",
        messageDebug,
        logger: { error: vi.fn() },
    } as unknown as App;
    registerMessageDebugRoutes(app, {
        get: vi.fn((route: string, handler: RouteHandler) => gets.set(route, handler)),
        post: vi.fn((route: string, handler: RouteHandler) => posts.set(route, handler)),
    } as unknown as Router);
    return { app, gets, posts, messageDebug };
}

describe("message debug routes", () => {
    it("历史快照发布完整实例身份", () => {
        const { gets } = setup();
        const ctx = { set: vi.fn() } as unknown as RouterContext;

        gets.get("/api/message-debug/history")!(ctx);

        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Application", "onebots");
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Runtime-Contract-Id", "sha256:contract-a");
        expect(ctx.body).toHaveLength(2);
    });

    it("事件流在注册客户端前声明实例身份", () => {
        const { app, gets, messageDebug } = setup();
        const write = vi.fn();
        const registerClient = vi
            .spyOn(messageDebug, "registerClient")
            .mockImplementation(() => {});
        const ctx = streamContext(write);

        gets.get("/api/message-debug/stream")!(ctx);

        expect(write).toHaveBeenCalledOnce();
        expect(String(write.mock.calls[0]?.[0])).toContain(
            '"event":"identity","application":"onebots","version":"1.2.8","instance_id":"instance-a"',
        );
        expect(registerClient).toHaveBeenCalledOnce();
        vi.mocked(registerClient).mock.calls[0]?.[1]();
        expect(app.logger.error).not.toHaveBeenCalled();
    });

    it("实例切换后在触碰缓冲区前拒绝清空", () => {
        const { posts, messageDebug } = setup();
        const clear = vi.spyOn(messageDebug, "clear");
        const ctx = mutationContext("instance-before-restart");

        posts.get("/api/message-debug/clear")!(ctx);

        expect(ctx.status).toBe(409);
        expect(clear).not.toHaveBeenCalled();
        expect(ctx.body).toMatchObject({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            message: expect.stringContaining("当前已由实例 instance-a 接管"),
        });
    });

    it("清空回执给出准确数量与序号边界", () => {
        const { posts, messageDebug } = setup();
        const ctx = mutationContext("instance-a");

        posts.get("/api/message-debug/clear")!(ctx);

        expect(ctx.body).toEqual({
            success: true,
            application: "onebots",
            instance_id: "instance-a",
            cleared_count: 2,
            cleared_through_seq: 2,
        });
        expect(messageDebug.getHistory()).toEqual([]);
        messageDebug.recordInbound("mock", "demo", { text: "after" });
        expect(messageDebug.getHistory()[0]?.seq).toBe(3);
    });
});

function mutationContext(expectedInstanceId: string): RouterContext {
    return {
        get: (name: string) =>
            name === MANAGEMENT_EXPECTED_INSTANCE_HEADER ? expectedInstanceId : "",
        set: vi.fn(),
    } as unknown as RouterContext;
}

function streamContext(write: ReturnType<typeof vi.fn>): RouterContext {
    return {
        state: { token: undefined },
        set: vi.fn(),
        request: {
            socket: { setTimeout: vi.fn(), setNoDelay: vi.fn(), setKeepAlive: vi.fn() },
        },
        req: {
            socket: { setNoDelay: vi.fn(), setKeepAlive: vi.fn() },
            on: vi.fn(),
        },
        res: { write, end: vi.fn() },
    } as unknown as RouterContext;
}
