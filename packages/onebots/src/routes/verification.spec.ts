import type { Adapter, RouterContext } from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import type { App } from "../app.js";
import { registerVerificationRoutes } from "./verification.js";

type RouteHandler = (ctx: RouterContext) => void | Promise<void>;

function setup(adapter = verificationAdapter()) {
    const gets = new Map<string, RouteHandler>();
    const posts = new Map<string, RouteHandler>();
    const pending = new Map([
        [
            "mock:demo:sms",
            {
                payload: { platform: "mock", account_id: "demo", type: "sms" },
                createdAt: Date.now(),
            },
        ],
    ]);
    const app = {
        info: {
            application_name: "onebots",
            application_version: "1.2.8",
            instance_id: "instance-a",
        },
        runtimeContractId: "sha256:contract-a",
        adapters: new Map([["mock", adapter]]),
        pendingVerifications: pending,
        getPendingVerificationList: vi.fn(() => [...pending.values()].map(item => item.payload)),
        registerVerificationClient: vi.fn(),
        removeVerificationClient: vi.fn(),
        logger: { error: vi.fn() },
    } as unknown as App;
    registerVerificationRoutes(app, {
        get: vi.fn((route: string, handler: RouteHandler) => gets.set(route, handler)),
        post: vi.fn((route: string, handler: RouteHandler) => posts.set(route, handler)),
    } as never);
    return { app, adapter, gets, posts };
}

describe("verification management routes", () => {
    it("待处理列表发布完整实例身份", () => {
        const { gets } = setup();
        const ctx = { set: vi.fn() } as unknown as RouterContext;

        gets.get("/api/verification/pending")!(ctx);

        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Application", "onebots");
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Version", "1.2.8");
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Runtime-Contract-Id", "sha256:contract-a");
        expect(ctx.body).toEqual([{ platform: "mock", account_id: "demo", type: "sms" }]);
    });

    it("每条验证事件流在业务事件前声明实例身份", () => {
        const { app, gets } = setup();
        const write = vi.fn();
        const closeHandlers: Array<() => void> = [];
        const ctx = {
            state: { token: "session-token" },
            set: vi.fn(),
            request: {
                socket: { setTimeout: vi.fn(), setNoDelay: vi.fn(), setKeepAlive: vi.fn() },
            },
            req: {
                socket: { setNoDelay: vi.fn(), setKeepAlive: vi.fn() },
                on: vi.fn((event: string, handler: () => void) => {
                    if (event === "close") closeHandlers.push(handler);
                }),
            },
            res: { write, end: vi.fn() },
        } as unknown as RouterContext;

        gets.get("/api/verification/stream")!(ctx);

        expect(write).toHaveBeenCalledOnce();
        expect(String(write.mock.calls[0]?.[0])).toContain(
            '"event":"identity","application":"onebots","version":"1.2.8","instance_id":"instance-a"',
        );
        expect(app.registerVerificationClient).toHaveBeenCalledOnce();
        const dispose = vi.mocked(app.registerVerificationClient).mock.calls[0]?.[1];
        dispose?.();
        closeHandlers.forEach(handler => handler());
    });

    it.each([
        ["/api/verification/request-sms", "短信验证码请求", "requestSmsCode"],
        ["/api/verification/submit", "账号验证提交", "submitVerification"],
    ] as const)("%s 在实例切换后不调用适配器", async (route, operation, method) => {
        const { adapter, posts } = setup();
        const ctx = mutationContext("instance-before-restart");

        await posts.get(route)!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            message: `${operation}请求期望实例 instance-before-restart，当前已由实例 instance-a 接管`,
        });
        expect(adapter[method]).not.toHaveBeenCalled();
    });

    it("验证提交成功后返回实例回执并清除对应待处理项", async () => {
        const { app, adapter, posts } = setup();
        const ctx = mutationContext("instance-a");

        await posts.get("/api/verification/submit")!(ctx);

        expect(adapter.submitVerification).toHaveBeenCalledWith("demo", "sms", { code: "123456" });
        expect(app.pendingVerifications.has("mock:demo:sms")).toBe(false);
        expect(ctx.body).toEqual({
            success: true,
            application: "onebots",
            instance_id: "instance-a",
        });
        expect(ctx.set).toHaveBeenCalledWith("Cache-Control", "no-store");
    });
});

function verificationAdapter() {
    return {
        requestSmsCode: vi.fn(async () => undefined),
        submitVerification: vi.fn(async () => undefined),
    } as unknown as Adapter & {
        requestSmsCode: ReturnType<typeof vi.fn>;
        submitVerification: ReturnType<typeof vi.fn>;
    };
}

function mutationContext(expectedInstanceId: string): RouterContext {
    return {
        get: () => expectedInstanceId,
        set: vi.fn(),
        request: {
            body: {
                platform: "mock",
                account_id: "demo",
                type: "sms",
                data: { code: "123456" },
            },
        },
    } as unknown as RouterContext;
}
