import {
    AccountConfigDriftError,
    AccountMutationConflictError,
    UnsupportedCapabilityError,
    ValidationError,
    type Adapter,
    type RouterContext,
} from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import type { App } from "../app.js";
import { createManagementConfigRevision } from "../management-config-revision.js";
import { registerAdapterRoutes } from "./adapter-api.js";

type RouteHandler = (ctx: RouterContext) => void | Promise<void>;
const persistedConfig = "mock.demo:\n  account_id: demo\n";

function setup(overrides: Partial<App> = {}) {
    const gets = new Map<string, RouteHandler>();
    const posts = new Map<string, RouteHandler>();
    const app = {
        adapterInfos: [],
        adapterCapabilityReport: { complete: true, errors: [], adapters: [] },
        runtimeContractId: "sha256:contract-a",
        info: {
            application_name: "onebots",
            application_version: "1.2.8",
            instance_id: "instance-a",
        },
        accounts: [],
        adapters: new Map(),
        logger: { error: vi.fn() },
        addAccount: vi.fn(async () => persistedConfig),
        updateAccount: vi.fn(async () => persistedConfig),
        removeAccount: vi.fn(async () => persistedConfig),
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
            application: { name: "onebots", version: "1.2.8", instanceId: "instance-a" },
            complete: true,
            errors: [],
            adapters: [{ name: "qq", source: "catalog", status: "verified" }],
        };
        const { gets } = setup({ adapterInfos, adapterCapabilityReport: report } as Partial<App>);
        const adaptersContext = { set: vi.fn() } as unknown as RouterContext;
        const capabilitiesContext = { set: vi.fn() } as unknown as RouterContext;

        gets.get("/api/adapters")!(adaptersContext);
        gets.get("/api/adapter-capabilities")!(capabilitiesContext);

        expect(adaptersContext.body).toBe(adapterInfos);
        expect(adaptersContext.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
        expect(adaptersContext.set).toHaveBeenCalledWith(
            "X-OneBots-Runtime-Contract-Id",
            "sha256:contract-a",
        );
        expect(adaptersContext.set).toHaveBeenCalledWith("Cache-Control", "no-store");
        expect(capabilitiesContext.body).toBe(report);
        expect(capabilitiesContext.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
        expect(capabilitiesContext.set).toHaveBeenCalledWith(
            "X-OneBots-Runtime-Contract-Id",
            "sha256:contract-a",
        );
        expect(capabilitiesContext.set).toHaveBeenCalledWith("Cache-Control", "no-store");
    });

    it("账号配置事务冲突返回 409", async () => {
        const addAccount = vi.fn(async () => {
            throw new AccountMutationConflictError();
        });
        const { posts } = setup({ addAccount } as Partial<App>);
        const ctx = accountMutationContext({ platform: "mock", account_id: "10001" });

        await posts.get("/api/add")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_CONFIG_BUSY",
            message: "OneBots 配置正在变更，请稍后重试账号操作",
        });
    });

    it("账号磁盘漂移发布稳定错误码供 Web 丢弃旧表单", async () => {
        const updateAccount = vi.fn(async () => {
            throw new AccountConfigDriftError();
        });
        const { posts } = setup({ updateAccount } as Partial<App>);
        const ctx = accountMutationContext({ platform: "mock", account_id: "10001" });

        await posts.get("/api/edit")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toMatchObject({
            success: false,
            code: "ACCOUNT_CONFIG_DRIFT",
            message: expect.stringContaining("已保留最新文件"),
        });
    });

    it("账号候选配置校验失败返回 400", async () => {
        const addAccount = vi.fn(async () => {
            throw new ValidationError("运行时配置无效：mock.demo.token: is required");
        });
        const { posts } = setup({ addAccount } as Partial<App>);
        const ctx = accountMutationContext({ platform: "mock", account_id: "demo" });

        await posts.get("/api/add")!(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_CONFIG_INVALID",
            message: "运行时配置无效：mock.demo.token: is required",
        });
    });

    it.each([
        ["/api/add", "账号新增", "addAccount"],
        ["/api/edit", "账号编辑", "updateAccount"],
    ] as const)("%s 在实例切换后拒绝过期账号写入", async (route, operation, method) => {
        const { app, posts } = setup();
        const ctx = {
            get: () => "instance-before-restart",
            set: vi.fn(),
            request: { body: { platform: "mock", account_id: "demo" } },
        } as unknown as RouterContext;

        await posts.get(route)!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_INSTANCE_MISMATCH",
            message: `${operation}请求期望实例 instance-before-restart，当前已由实例 instance-a 接管`,
        });
        expect(app[method]).not.toHaveBeenCalled();
    });

    it("账号写入拒绝畸形配置修订号且不调用 Core", async () => {
        const { app, posts } = setup();
        const ctx = {
            get: (name: string) =>
                name === "X-OneBots-Expected-Instance-Id" ? "instance-a" : "stale",
            set: vi.fn(),
            request: { body: { platform: "mock", account_id: "demo" } },
        } as unknown as RouterContext;

        await posts.get("/api/add")!(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_CONFIG_INVALID",
            message: "账号新增请求的配置修订号无效",
        });
        expect(app.addAccount).not.toHaveBeenCalled();
    });

    it.each([
        ["/api/add", "add", "addAccount", "添加成功"],
        ["/api/edit", "edit", "updateAccount", "修改成功"],
    ] as const)(
        "%s 返回处理实例、目标和精确提交修订",
        async (route, operation, method, message) => {
            const { app, posts } = setup();
            const ctx = accountMutationContext(
                { platform: "mock", account_id: "demo" },
                "instance-a",
            );

            await posts.get(route)!(ctx);

            expect(app[method]).toHaveBeenCalledOnce();
            expect(ctx.body).toEqual(accountMutationSuccess(operation, "mock", "demo", message));
            expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Application", "onebots");
            expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
            expect(ctx.set).toHaveBeenCalledWith(
                "X-OneBots-Config-Revision",
                createManagementConfigRevision(persistedConfig),
            );
        },
    );

    it("适配器未实际提交账号时不返回伪成功", async () => {
        const addAccount = vi.fn(async () => undefined);
        const { posts } = setup({ addAccount } as Partial<App>);
        const ctx = accountMutationContext({ platform: "missing", account_id: "demo" });

        await posts.get("/api/add")!(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_CONFIG_INVALID",
            message: "无法添加账号 missing.demo：适配器不可用",
        });
    });

    it("删除账号缺少身份参数时返回 400 且不调用 Core", async () => {
        const { app, gets } = setup();
        const ctx = {
            request: { query: { platform: "mock" } },
            set: vi.fn(),
        } as unknown as RouterContext;

        await gets.get("/api/remove")!(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_CONFIG_INVALID",
            message: "查询参数 uin 必须是非空字符串",
        });
        expect(app.removeAccount).not.toHaveBeenCalled();
    });

    it("实例切换后在读取目标和调用 Core 前拒绝账号删除", async () => {
        const { app, gets } = setup();
        const ctx = {
            get: () => "instance-before-restart",
            request: { query: { platform: "mock", uin: "demo" } },
            set: vi.fn(),
        } as unknown as RouterContext;

        await gets.get("/api/remove")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_INSTANCE_MISMATCH",
            message: "账号删除请求期望实例 instance-before-restart，当前已由实例 instance-a 接管",
        });
        expect(app.removeAccount).not.toHaveBeenCalled();
    });

    it("POST 删除在解析请求体前拒绝已切换实例的旧页面", async () => {
        const { app, posts } = setup();
        const ctx = {
            get: () => "instance-before-restart",
            request: { body: "malformed" },
            set: vi.fn(),
        } as unknown as RouterContext;

        await posts.get("/api/remove")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_INSTANCE_MISMATCH",
            message: "账号删除请求期望实例 instance-before-restart，当前已由实例 instance-a 接管",
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
            set: vi.fn(),
        } as unknown as RouterContext;

        await gets.get("/api/remove")!(ctx);

        expect(app.removeAccount).toHaveBeenCalledWith("mock", "10001", expected);
        expect(ctx.body).toEqual(accountMutationSuccess("remove", "mock", "10001", "移除成功"));
    });

    it("使用 POST 请求体删除账号并严格校验 force", async () => {
        const { app, posts } = setup();
        const valid = {
            request: { body: { platform: "mock", uin: "10001", force: true } },
            set: vi.fn(),
        } as unknown as RouterContext;

        await posts.get("/api/remove")!(valid);

        expect(app.removeAccount).toHaveBeenCalledWith("mock", "10001", true);
        expect(valid.body).toEqual(accountMutationSuccess("remove", "mock", "10001", "移除成功"));
        expect(valid.set).toHaveBeenCalledWith(
            "X-OneBots-Config-Revision",
            createManagementConfigRevision(persistedConfig),
        );
        expect(valid.set).toHaveBeenCalledWith("Cache-Control", "no-store");

        const invalid = {
            request: { body: { platform: "mock", uin: "10001", force: "false" } },
            set: vi.fn(),
        } as unknown as RouterContext;
        await posts.get("/api/remove")!(invalid);
        expect(invalid.status).toBe(400);
        expect(invalid.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_CONFIG_INVALID",
            message: "请求字段 force 必须是布尔值",
        });
        expect(app.removeAccount).toHaveBeenCalledTimes(1);
    });

    it("保留 GET 删除兼容入口并明确标记弃用", async () => {
        const { gets } = setup();
        const ctx = {
            request: { query: { platform: "mock", uin: "10001" } },
            set: vi.fn(),
        } as unknown as RouterContext;

        await gets.get("/api/remove")!(ctx);

        expect(ctx.set).toHaveBeenCalledWith("Deprecation", "@1788307200");
        expect(ctx.set).toHaveBeenCalledWith(
            "Warning",
            '299 OneBots "GET /api/remove is deprecated; use POST with a JSON body"',
        );
    });

    it.each(["/api/bots/start", "/api/bots/stop"])("%s 缺少账号身份时返回 400", async route => {
        const { posts } = setup();
        const ctx = lifecycleContext({ platform: "mock" });

        await posts.get(route)!(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_REQUEST_INVALID",
            message: "请求字段 uin 必须是非空字符串",
        });
    });

    it("启动不存在的适配器时返回 404 而不是静默成功", async () => {
        const { posts } = setup();
        const ctx = lifecycleContext({ platform: "missing", uin: "demo" });

        await posts.get("/api/bots/start")!(ctx);

        expect(ctx.status).toBe(404);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_TARGET_NOT_FOUND",
            message: "适配器 missing 不存在",
        });
    });

    it("拒绝由其他实例快照发起的账号操作", async () => {
        const account = { info: { platform: "mock", uin: "demo", status: "online" } };
        const adapter = lifecycleAdapter(account);
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const ctx = lifecycleContext({
            platform: "mock",
            uin: "demo",
            expected_instance_id: "instance-before-restart",
        });

        await posts.get("/api/bots/start")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_INSTANCE_MISMATCH",
            message: "账号操作期望实例 instance-before-restart，当前已由实例 instance-a 接管",
        });
        expect(adapter.setOnline).not.toHaveBeenCalled();
    });

    it("停止不存在的账号时返回 404 且不调用适配器", async () => {
        const adapter = lifecycleAdapter(undefined);
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const ctx = lifecycleContext({ platform: "mock", uin: "missing" });

        await posts.get("/api/bots/stop")!(ctx);

        expect(ctx.status).toBe(404);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_TARGET_NOT_FOUND",
            message: "账号 mock.missing 不存在",
        });
        expect(adapter.setOffline).not.toHaveBeenCalled();
    });

    it("未实现手动生命周期控制时返回 501", async () => {
        const account = { info: { platform: "mock", uin: "demo", status: "offline" } };
        const adapter = lifecycleAdapter(account, {
            setOnline: vi.fn(async () => {
                throw new UnsupportedCapabilityError({
                    platform: "mock",
                    capability: "account.set_online",
                });
            }),
        });
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const ctx = lifecycleContext({ platform: "mock", uin: "demo" });

        await posts.get("/api/bots/start")!(ctx);

        expect(ctx.status).toBe(501);
        expect(ctx.body).toMatchObject({
            success: false,
            code: "ACCOUNT_LIFECYCLE_UNSUPPORTED",
            message: expect.stringContaining("account.set_online"),
        });
    });

    it("真实生命周期操作完成后返回最新账号状态", async () => {
        const account = { info: { platform: "mock", uin: "demo", status: "online" } };
        const adapter = lifecycleAdapter(account);
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const ctx = lifecycleContext({ platform: "mock", uin: "demo" }, "instance-a");

        await posts.get("/api/bots/start")!(ctx);

        expect(adapter.setOnline).toHaveBeenCalledWith("demo");
        expect(ctx.status).toBeUndefined();
        expect(ctx.body).toEqual({
            success: true,
            application: "onebots",
            instance_id: "instance-a",
            data: account.info,
        });
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
        expect(ctx.set).toHaveBeenCalledWith("Cache-Control", "no-store");
    });

    it("同一账号的并发生命周期请求返回 409 且不交错调用插件", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const account = { info: { platform: "mock", uin: "demo", status: "online" } };
        const adapter = lifecycleAdapter(account, { setOnline: vi.fn(() => gate) });
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const startCtx = lifecycleContext({ platform: "mock", uin: "demo" });
        const stopCtx = lifecycleContext({ platform: "mock", uin: "demo" });

        const starting = posts.get("/api/bots/start")!(startCtx);
        await vi.waitFor(() => expect(adapter.setOnline).toHaveBeenCalledOnce());
        await posts.get("/api/bots/stop")!(stopCtx);

        expect(stopCtx.status).toBe(409);
        expect(stopCtx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_LIFECYCLE_CONFLICT",
            message: "账号 mock.demo 正在执行上线操作，请稍后重试",
        });
        expect(adapter.setOffline).not.toHaveBeenCalled();

        release();
        await starting;
        expect(startCtx.body).toEqual({
            success: true,
            application: "onebots",
            instance_id: "instance-a",
            data: account.info,
        });
    });

    it("标准实例 header 在读取兼容正文和调用适配器前拒绝旧页面", async () => {
        const account = { info: { platform: "mock", uin: "demo", status: "offline" } };
        const adapter = lifecycleAdapter(account);
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const ctx = lifecycleContext("malformed", "instance-before-restart");

        await posts.get("/api/bots/start")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            code: "ACCOUNT_INSTANCE_MISMATCH",
            message: "账号上线请求期望实例 instance-before-restart，当前已由实例 instance-a 接管",
        });
        expect(adapter.setOnline).not.toHaveBeenCalled();
    });

    it("实例切换后在读取账号和调用适配器前拒绝消息发送", async () => {
        const adapter = sendAdapter();
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const ctx = {
            get: () => "instance-before-restart",
            set: vi.fn(),
            request: {
                body: {
                    channel: "mock.demo",
                    target_id: "user-1",
                    target_type: "private",
                    message: "hello",
                },
            },
        } as unknown as RouterContext;

        await posts.get("/api/send")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            message: "消息发送请求期望实例 instance-before-restart，当前已由实例 instance-a 接管",
        });
        expect(adapter.getAccount).not.toHaveBeenCalled();
        expect(adapter.sendMessage).not.toHaveBeenCalled();
    });

    it("消息发送成功响应同时发布头部和正文实例身份", async () => {
        const adapter = sendAdapter();
        const { posts } = setup({ adapters: new Map([["mock", adapter]]) } as Partial<App>);
        const ctx = {
            get: () => "instance-a",
            set: vi.fn(),
            request: {
                body: {
                    channel: "mock.demo",
                    target_id: "user-1",
                    target_type: "private",
                    message: "hello",
                },
            },
        } as unknown as RouterContext;

        await posts.get("/api/send")!(ctx);

        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Application", "onebots");
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Version", "1.2.8");
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
        expect(ctx.set).toHaveBeenCalledWith("Cache-Control", "no-store");
        expect(adapter.sendMessage).toHaveBeenCalledOnce();
        expect(ctx.body).toEqual({
            success: true,
            application: "onebots",
            instance_id: "instance-a",
            message_id: "message-1",
        });
    });
});

function lifecycleAdapter(
    account: { info: { platform: string; uin: string; status: string } } | undefined,
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

function lifecycleContext(body: unknown, expectedInstanceId = ""): RouterContext {
    return {
        get: (name: string) =>
            name === "X-OneBots-Expected-Instance-Id" ? expectedInstanceId : "",
        set: vi.fn(),
        request: { body },
    } as unknown as RouterContext;
}

function accountMutationContext(body: unknown, expectedInstanceId = ""): RouterContext {
    return {
        get: (name: string) =>
            name === "X-OneBots-Expected-Instance-Id" ? expectedInstanceId : "",
        set: vi.fn(),
        request: { body },
    } as unknown as RouterContext;
}

function accountMutationSuccess(
    operation: "add" | "edit" | "remove",
    platform: string,
    accountId: string,
    message: string,
) {
    return {
        success: true,
        application: "onebots",
        instance_id: "instance-a",
        config_revision: createManagementConfigRevision(persistedConfig),
        operation,
        target: { platform, account_id: accountId },
        message,
    };
}

function sendAdapter() {
    return {
        getAccount: vi.fn(() => ({ info: { uin: "demo" } })),
        createId: vi.fn((value: string) => value),
        sendMessage: vi.fn(async () => ({ message_id: "message-1" })),
    } as unknown as Adapter & {
        getAccount: ReturnType<typeof vi.fn>;
        sendMessage: ReturnType<typeof vi.fn>;
    };
}
