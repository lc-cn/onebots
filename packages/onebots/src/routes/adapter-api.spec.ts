import {
    AccountMutationConflictError,
    UnsupportedCapabilityError,
    ValidationError,
    type Adapter,
    type RouterContext,
} from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import type { App } from "../app.js";
import { registerAdapterRoutes } from "./adapter-api.js";

type RouteHandler = (ctx: RouterContext) => void | Promise<void>;

function setup(overrides: Partial<App> = {}) {
    const gets = new Map<string, RouteHandler>();
    const posts = new Map<string, RouteHandler>();
    const app = {
        adapterInfos: [],
        adapterCapabilityReport: { complete: true, errors: [], adapters: [] },
        accounts: [],
        adapters: new Map(),
        logger: { error: vi.fn() },
        addAccount: vi.fn(async () => undefined),
        updateAccount: vi.fn(async () => undefined),
        removeAccount: vi.fn(async () => undefined),
        ...overrides,
    } as unknown as App;
    registerAdapterRoutes(app, {
        get: vi.fn((route: string, handler: RouteHandler) => gets.set(route, handler)),
        post: vi.fn((route: string, handler: RouteHandler) => posts.set(route, handler)),
    } as never);
    return { app, gets, posts };
}

describe("adapter account routes", () => {
    it("无账号时通过独立端点返回完整能力证据且不污染已加载适配器清单", () => {
        const adapterInfos = [{ platform: "loaded", accounts: [] }];
        const report = {
            schemaVersion: 1 as const,
            generatedAt: "2026-09-01T00:00:00.000Z",
            application: { name: "onebots", version: "1.2.8" },
            complete: true,
            errors: [],
            adapters: [{ name: "qq", source: "catalog", status: "verified" }],
        };
        const { gets } = setup({ adapterInfos, adapterCapabilityReport: report } as Partial<App>);
        const adaptersContext = {} as RouterContext;
        const capabilitiesContext = {} as RouterContext;

        gets.get("/api/adapters")!(adaptersContext);
        gets.get("/api/adapter-capabilities")!(capabilitiesContext);

        expect(adaptersContext.body).toBe(adapterInfos);
        expect(capabilitiesContext.body).toBe(report);
    });

    it("账号配置事务冲突返回 409", async () => {
        const addAccount = vi.fn(async () => {
            throw new AccountMutationConflictError();
        });
        const { posts } = setup({ addAccount } as Partial<App>);
        const ctx = {
            request: { body: { platform: "mock", account_id: "10001" } },
        } as RouterContext;

        await posts.get("/api/add")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({
            success: false,
            message: "OneBots 配置正在变更，请稍后重试账号操作",
        });
    });

    it("账号候选配置校验失败返回 400", async () => {
        const addAccount = vi.fn(async () => {
            throw new ValidationError("运行时配置无效：mock.demo.token: is required");
        });
        const { posts } = setup({ addAccount } as Partial<App>);
        const ctx = {
            request: { body: { platform: "mock", account_id: "demo" } },
        } as RouterContext;

        await posts.get("/api/add")!(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({
            success: false,
            message: "运行时配置无效：mock.demo.token: is required",
        });
    });

    it("删除账号缺少身份参数时返回 400 且不调用 Core", async () => {
        const { app, gets } = setup();
        const ctx = { request: { query: { platform: "mock" } } } as unknown as RouterContext;

        await gets.get("/api/remove")!(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({
            success: false,
            message: "查询参数 uin 必须是非空字符串",
        });
        expect(app.removeAccount).not.toHaveBeenCalled();
    });

    it.each([
        ["false", false],
        ["0", false],
        ["true", true],
        ["1", true],
    ])("将 force=%s 解析为 %s", async (force, expected) => {
        const { app, gets } = setup();
        const ctx = {
            request: { query: { platform: "mock", uin: "10001", force } },
        } as unknown as RouterContext;

        await gets.get("/api/remove")!(ctx);

        expect(app.removeAccount).toHaveBeenCalledWith("mock", "10001", expected);
        expect(ctx.body).toEqual({ success: true, message: "移除成功" });
    });

    it.each(["/api/bots/start", "/api/bots/stop"])("%s 缺少账号身份时返回 400", async route => {
        const { posts } = setup();
        const ctx = { request: { body: { platform: "mock" } } } as RouterContext;

        await posts.get(route)!(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({
            success: false,
            code: "ACCOUNT_REQUEST_INVALID",
            message: "请求字段 uin 必须是非空字符串",
        });
    });

    it("启动不存在的适配器时返回 404 而不是静默成功", async () => {
        const { posts } = setup();
        const ctx = {
            request: { body: { platform: "missing", uin: "demo" } },
        } as RouterContext;

        await posts.get("/api/bots/start")!(ctx);

        expect(ctx.status).toBe(404);
        expect(ctx.body).toEqual({
            success: false,
            code: "ACCOUNT_TARGET_NOT_FOUND",
            message: "适配器 missing 不存在",
        });
    });

    it("停止不存在的账号时返回 404 且不调用适配器", async () => {
        const adapter = lifecycleAdapter(undefined);
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const ctx = {
            request: { body: { platform: "mock", uin: "missing" } },
        } as RouterContext;

        await posts.get("/api/bots/stop")!(ctx);

        expect(ctx.status).toBe(404);
        expect(ctx.body).toEqual({
            success: false,
            code: "ACCOUNT_TARGET_NOT_FOUND",
            message: "账号 mock.missing 不存在",
        });
        expect(adapter.setOffline).not.toHaveBeenCalled();
    });

    it("未实现手动生命周期控制时返回 501", async () => {
        const account = { info: { uin: "demo", status: "offline" } };
        const adapter = lifecycleAdapter(account, {
            setOnline: vi.fn(async () => {
                throw new UnsupportedCapabilityError({
                    platform: "mock",
                    capability: "account.set_online",
                });
            }),
        });
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const ctx = {
            request: { body: { platform: "mock", uin: "demo" } },
        } as RouterContext;

        await posts.get("/api/bots/start")!(ctx);

        expect(ctx.status).toBe(501);
        expect(ctx.body).toMatchObject({
            success: false,
            code: "ACCOUNT_LIFECYCLE_UNSUPPORTED",
            message: expect.stringContaining("account.set_online"),
        });
    });

    it("真实生命周期操作完成后返回最新账号状态", async () => {
        const account = { info: { uin: "demo", status: "online" } };
        const adapter = lifecycleAdapter(account);
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const ctx = {
            request: { body: { platform: "mock", uin: "demo" } },
        } as RouterContext;

        await posts.get("/api/bots/start")!(ctx);

        expect(adapter.setOnline).toHaveBeenCalledWith("demo");
        expect(ctx.status).toBeUndefined();
        expect(ctx.body).toEqual({ success: true, data: account.info });
    });

    it("同一账号的并发生命周期请求返回 409 且不交错调用插件", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const account = { info: { uin: "demo", status: "online" } };
        const adapter = lifecycleAdapter(account, { setOnline: vi.fn(() => gate) });
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const startCtx = {
            request: { body: { platform: "mock", uin: "demo" } },
        } as RouterContext;
        const stopCtx = {
            request: { body: { platform: "mock", uin: "demo" } },
        } as RouterContext;

        const starting = posts.get("/api/bots/start")!(startCtx);
        await vi.waitFor(() => expect(adapter.setOnline).toHaveBeenCalledOnce());
        await posts.get("/api/bots/stop")!(stopCtx);

        expect(stopCtx.status).toBe(409);
        expect(stopCtx.body).toEqual({
            success: false,
            code: "ACCOUNT_LIFECYCLE_CONFLICT",
            message: "账号 mock.demo 正在执行上线操作，请稍后重试",
        });
        expect(adapter.setOffline).not.toHaveBeenCalled();

        release();
        await starting;
        expect(startCtx.body).toEqual({ success: true, data: account.info });
    });
});

function lifecycleAdapter(
    account: { info: { uin: string; status: string } } | undefined,
    overrides: Record<string, unknown> = {},
) {
    return {
        getAccount: vi.fn(() => account),
        setOnline: vi.fn(async () => undefined),
        setOffline: vi.fn(async () => undefined),
        ...overrides,
    } as unknown as Adapter & {
        setOnline: ReturnType<typeof vi.fn>;
        setOffline: ReturnType<typeof vi.fn>;
    };
}
