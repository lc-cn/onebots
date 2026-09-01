import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    assertHostConfigReloadable,
    ConfigRestartRequiredError,
    HostConfigRestartRequiredError,
    resolveListenPort,
} from "./app-reload.js";
import { Account, AccountStatus } from "./account.js";
import { Adapter } from "./adapter.js";
import { BaseApp } from "./base-app.js";
import { AdapterRegistry } from "./registry.js";

const config = {
    port: 6727,
    path: "",
    database: "onebots.db",
    timeout: 30,
    username: "admin",
    password: "password",
    access_token: "token",
    log_level: "info",
    public_static_dir: "static",
    general: {},
    env: "development",
    keys: [],
    proxy: false,
    subdomainOffset: 2,
    proxyIpHeader: "X-Forwarded-For",
    maxIpsCount: 0,
} satisfies Required<BaseApp.Config>;

describe("BaseApp reload boundary", () => {
    it("首次启动保留失败诊断，而严格重载会在尝试全部适配器后传播失败", async () => {
        const failedStart = vi.fn(async () => {
            throw new Error("adapter failed");
        });
        const healthyStart = vi.fn(async () => undefined);
        const app = {
            adapters: new Map([
                ["failed", { start: failedStart }],
                ["healthy", { start: healthyStart }],
            ]),
            enhancedLogger: { error: vi.fn() },
        };
        const startAdapters = (
            BaseApp.prototype as unknown as {
                startAdapters(throwOnFailure?: boolean): Promise<void>;
            }
        ).startAdapters;

        await expect(startAdapters.call(app)).resolves.toBeUndefined();
        await expect(startAdapters.call(app, true)).rejects.toThrow("adapter failed");
        expect(failedStart).toHaveBeenCalledTimes(2);
        expect(healthyStart).toHaveBeenCalledTimes(2);
        expect(app.enhancedLogger.error).toHaveBeenCalledTimes(2);
    });

    it("允许账号、协议、凭据与日志配置热重载", () => {
        expect(() =>
            assertHostConfigReloadable(config, {
                ...config,
                log_level: "debug",
                access_token: "next-token",
                general: { "onebot.v11": { use_http: true } },
            }),
        ).not.toThrow();
    });

    it.each(["port", "database", "public_static_dir", "proxy"] as const)(
        "拒绝无法完整重建的宿主配置 %s",
        key => {
            expect(() =>
                assertHostConfigReloadable(config, {
                    ...config,
                    [key]: key === "port" ? 7000 : key === "proxy" ? true : "changed",
                }),
            ).toThrow(`宿主配置需要重启进程后生效: ${key}`);
        },
    );

    it("以结构化错误公开需要重启的宿主字段", () => {
        try {
            assertHostConfigReloadable(config, { ...config, port: 7000, path: "gateway" });
            throw new Error("预期宿主配置检查失败");
        } catch (error) {
            expect(error).toBeInstanceOf(HostConfigRestartRequiredError);
            expect(error).toBeInstanceOf(ConfigRestartRequiredError);
            expect((error as HostConfigRestartRequiredError).changed).toEqual(["port", "path"]);
        }
    });

    it("将 PORT 环境变量解析为 TCP 端口并拒绝非数字值", () => {
        expect(resolveListenPort(6727, "8080")).toBe(8080);
        expect(resolveListenPort(6727, undefined)).toBe(6727);
        expect(() => resolveListenPort(6727, "socket-name")).toThrow("PORT 必须是");
    });

    it("拒绝无法用于生产身份证明的空应用名称或版本", () => {
        expect(() => new BaseApp({}, { name: "", version: "1.0.0" })).toThrow(
            "应用身份必须包含非空的 name 与 version",
        );
        expect(() => new BaseApp({}, { name: "embedded", version: " " })).toThrow(
            "应用身份必须包含非空的 name 与 version",
        );
        expect(() => new BaseApp({}, { name: 42, version: "1.0.0" } as never)).toThrow(
            "应用身份必须包含非空的 name 与 version",
        );
    });

    it("初始化与重载都不会保留调用方配置的嵌套引用", async () => {
        const initialProtocol = { use_http: true };
        const initial = {
            general: { "onebot.v11": initialProtocol },
        } as BaseApp.Config;
        const app = new BaseApp(initial);

        initialProtocol.use_http = false;
        expect((app.config.general["onebot.v11"] as { use_http: boolean }).use_http).toBe(true);

        const reloadedProtocol = { use_http: false };
        const reloaded = {
            general: { "onebot.v11": reloadedProtocol },
        } as BaseApp.Config;
        await app.reload(reloaded);

        reloadedProtocol.use_http = true;
        expect((app.config.general["onebot.v11"] as { use_http: boolean }).use_http).toBe(false);
    });

    it("将规范化的宿主 path 应用于真实 HTTP 路由而不暴露根路径", async () => {
        const originalConfigDir = BaseApp.configDir;
        const originalPort = process.env.PORT;
        const directory = mkdtempSync(join(tmpdir(), "onebots-prefix-"));
        BaseApp.configDir = directory;
        process.env.PORT = "0";
        const app = new BaseApp(
            { database: "prefix.db", path: " gateway/ " },
            { name: "embedded-gateway", version: "9.8.7" },
        );
        app.router.post("/api/auth/login", ctx => {
            ctx.status = 401;
            ctx.body = { success: false };
        });

        try {
            await app.start();
            const address = app.httpServer.address();
            const port = address && typeof address === "object" ? address.port : 0;
            const [prefixed, root] = await Promise.all([
                fetch(`http://127.0.0.1:${port}/gateway/health`),
                fetch(`http://127.0.0.1:${port}/health`),
            ]);

            expect(app.config.path).toBe("/gateway");
            expect(app.router.opts.prefix).toBe("/gateway");
            expect(prefixed.status).toBe(200);
            await expect(prefixed.json()).resolves.toMatchObject({
                application: "embedded-gateway",
                version: "9.8.7",
            });
            const repeatedProbes = await Promise.all(
                Array.from({ length: 105 }, () => fetch(`http://127.0.0.1:${port}/gateway/health`)),
            );
            expect(repeatedProbes.every(response => response.status === 200)).toBe(true);
            await Promise.all(repeatedProbes.map(response => response.body?.cancel()));
            const authenticationAttempts = await Promise.all(
                Array.from({ length: 105 }, () =>
                    fetch(`http://127.0.0.1:${port}/gateway/api/auth/login`, { method: "POST" }),
                ),
            );
            expect(authenticationAttempts.every(response => response.status === 401)).toBe(true);
            await Promise.all(authenticationAttempts.map(response => response.body?.cancel()));
            expect(root.status).toBe(404);
            await root.body?.cancel();
        } finally {
            await app.stop();
            BaseApp.configDir = originalConfigDir;
            if (originalPort === undefined) delete process.env.PORT;
            else process.env.PORT = originalPort;
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it("运行态热重载保留 HTTP、Router 与生命周期资源", async () => {
        const originalConfigDir = BaseApp.configDir;
        const originalPort = process.env.PORT;
        const directory = mkdtempSync(join(tmpdir(), "onebots-reload-"));
        BaseApp.configDir = directory;
        process.env.PORT = "0";
        const app = new BaseApp(
            { database: "reload.db" },
            { name: "embedded-gateway", version: "9.8.7" },
        );

        try {
            await app.start();
            const server = app.httpServer;
            const router = app.router;
            const middlewareCount = app.middleware.length;
            const resourceCount = app.lifecycle.getResourceCount();
            const address = app.httpServer.address();
            const port = address && typeof address === "object" ? address.port : 0;

            app.isReloading = true;
            const [health, readiness, metrics] = await Promise.all([
                fetch(`http://127.0.0.1:${port}/health`),
                fetch(`http://127.0.0.1:${port}/ready`),
                fetch(`http://127.0.0.1:${port}/metrics`),
            ]);
            expect(health.headers.get("cache-control")).toBe("no-store");
            expect(readiness.headers.get("cache-control")).toBe("no-store");
            expect(metrics.headers.get("cache-control")).toBe("no-store");
            expect(health.status).toBe(200);
            const healthPayload = (await health.json()) as Record<string, unknown>;
            expect(healthPayload).toMatchObject({
                application: "embedded-gateway",
                version: "9.8.7",
                core_version: expect.any(String),
            });
            expect(app.info).toMatchObject({
                application_name: "embedded-gateway",
                application_version: "9.8.7",
                core_version: expect.any(String),
                instance_id: healthPayload.instance_id,
                started_at: healthPayload.started_at,
            });
            expect(readiness.status).toBe(503);
            await expect(readiness.json()).resolves.toMatchObject({
                ready: false,
                server: true,
                reloading: true,
            });
            const metricsBody = await metrics.text();
            expect(metricsBody).toContain('onebots_info{version="9.8.7"} 1');
            expect(metricsBody).toContain("onebots_core_info");
            expect(metricsBody).toContain("onebots_reloading 1");
            expect(metricsBody).toContain("onebots_config_in_sync 1");
            app.isReloading = false;

            await app.reload({ ...app.config, access_token: "next-token", log_level: "debug" });

            expect(app.httpServer).toBe(server);
            expect(app.httpServer.listening).toBe(true);
            expect(app.router).toBe(router);
            expect(app.middleware).toHaveLength(middlewareCount);
            expect(app.lifecycle.getResourceCount()).toBe(resourceCount);
            expect(app.config.access_token).toBe("next-token");
            expect(app.isReloading).toBe(false);

            const middlewareAfterReload = app.middleware.length;
            await app.start();
            expect(app.middleware).toHaveLength(middlewareAfterReload);
        } finally {
            await app.stop();
            await app.stop();
            await expect(app.start()).rejects.toThrow("不能再次启动");
            BaseApp.configDir = originalConfigDir;
            if (originalPort === undefined) delete process.env.PORT;
            else process.env.PORT = originalPort;
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it("热重载撤销旧账号路由并让相同路径由新账号接管", async () => {
        const originalConfigDir = BaseApp.configDir;
        const originalPort = process.env.PORT;
        const directory = mkdtempSync(join(tmpdir(), "onebots-route-scope-"));
        BaseApp.configDir = directory;
        process.env.PORT = "0";

        class ScopedRouteAdapter extends Adapter {
            constructor(app: BaseApp) {
                super(app, "route_scope_test" as never);
            }

            createAccount(accountConfig: Account.Config): Account {
                const account = new Account(this, {}, accountConfig);
                const marker = String(accountConfig.marker);
                this.app.router.get("/scoped-account", ctx => {
                    ctx.body = { marker, phase: "create" };
                });
                this.app.router.ws("/scoped-account/events");
                account.on("start", () => {
                    this.app.router.get("/scoped-start", ctx => {
                        ctx.body = { marker, phase: "start" };
                    });
                    account.status = AccountStatus.Online;
                });
                account.on("stop", () => {
                    account.status = AccountStatus.OffLine;
                });
                return account;
            }
        }

        AdapterRegistry.register("route_scope_test", ScopedRouteAdapter as never);
        const app = new BaseApp({
            database: "route-scope.db",
            "route_scope_test.primary": { marker: "old" },
        } as BaseApp.Config);

        try {
            await app.start();
            const address = app.httpServer.address();
            const port = address && typeof address === "object" ? address.port : 0;
            await expect(routeMarker(port, "/scoped-account")).resolves.toBe("old");
            await expect(routeMarker(port, "/scoped-start")).resolves.toBe("old");

            await app.reload({
                ...app.config,
                "route_scope_test.primary": { marker: "next" },
            } as BaseApp.Config);

            await expect(routeMarker(port, "/scoped-account")).resolves.toBe("next");
            await expect(routeMarker(port, "/scoped-start")).resolves.toBe("next");

            await app.updateAccount({
                platform: "route_scope_test",
                account_id: "primary",
                marker: "transaction",
            } as never);

            await expect(routeMarker(port, "/scoped-account")).resolves.toBe("transaction");
            await expect(routeMarker(port, "/scoped-start")).resolves.toBe("transaction");
            expect(app.router.stack.filter(layer => layer.path === "/scoped-account")).toHaveLength(
                1,
            );
            expect(app.router.stack.filter(layer => layer.path === "/scoped-start")).toHaveLength(
                1,
            );
            expect(
                app.router.getWsPaths().filter(path => path === "/scoped-account/events"),
            ).toHaveLength(1);
        } finally {
            await app.stop();
            AdapterRegistry.unregister("route_scope_test");
            BaseApp.configDir = originalConfigDir;
            if (originalPort === undefined) delete process.env.PORT;
            else process.env.PORT = originalPort;
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it("账号配置成功落盘后通知宿主更新已应用快照", async () => {
        const originalConfigDir = BaseApp.configDir;
        const directory = mkdtempSync(join(tmpdir(), "onebots-persist-hook-"));
        BaseApp.configDir = directory;
        const adapter = {
            accounts: new Map(),
        } as unknown as Adapter;
        const accountConfig = { platform: "mock", account_id: "primary" };
        const account = {
            adapter,
            config: accountConfig,
            platform: accountConfig.platform,
            account_id: accountConfig.account_id,
            protocols: [],
            start: vi.fn(async () => undefined),
            stop: vi.fn(async () => undefined),
            dispatch: vi.fn(),
            dispatchAwaited: vi.fn(async () => undefined),
            dispatchManyAwaited: vi.fn(async () => undefined),
            attachRouteScope: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
            emit: vi.fn(),
            removeAllListeners: vi.fn(),
        } as unknown as Account;
        adapter.createAccount = vi.fn(() => account);
        const onConfigPersisted = vi.fn();
        const app = {
            config: { ...config },
            configPath: BaseApp.configPath,
            isStarted: false,
            isReloading: false,
            adapters: new Map(),
            findOrCreateAdapter: vi.fn(() => adapter),
            validateAccountConfigCandidate: vi.fn(),
            onConfigPersisted,
        } as unknown as BaseApp;

        try {
            await BaseApp.prototype.addAccount.call(app, accountConfig);

            expect(existsSync(BaseApp.configPath)).toBe(true);
            expect(onConfigPersisted).toHaveBeenCalledOnce();
            expect(onConfigPersisted).toHaveBeenCalledWith(
                BaseApp.configPath,
                expect.stringContaining("mock.primary:"),
            );
        } finally {
            BaseApp.configDir = originalConfigDir;
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it("重载全程撤销 readiness 并拒绝并发配置覆盖", async () => {
        let releaseStop: (() => void) | undefined;
        const stopPending = new Promise<void>(resolve => {
            releaseStop = resolve;
        });
        const app = {
            config,
            isReloading: false,
            runtimeOperation: "idle",
            isStarted: true,
            adapters: new Map(),
            logger: { level: "info" },
            enhancedLogger: { setLevel: vi.fn() },
            stopAdapters: vi.fn(() => stopPending),
            initAdapters: vi.fn(),
            startAdapters: vi.fn(),
        } as unknown as BaseApp;

        const firstReload = BaseApp.prototype.reload.call(app, {
            ...config,
            access_token: "next-token",
        });
        await vi.waitFor(() => expect(app.isReloading).toBe(true));
        expect(app.runtimeOperation).toBe("configuration_reload");
        await expect(BaseApp.prototype.reload.call(app, config)).rejects.toThrow("运行态正在变更");

        releaseStop?.();
        await firstReload;
        expect(app.isReloading).toBe(false);
        expect(app.runtimeOperation).toBe("idle");
        expect(app.config.access_token).toBe("next-token");
    });

    it("候选配置校验失败时仍释放运行态租约", async () => {
        const app = {
            config,
            isReloading: false,
            runtimeOperation: "idle",
        } as unknown as BaseApp;

        await expect(BaseApp.prototype.reload.call(app, { port: 0 })).rejects.toThrow();

        expect(app).toMatchObject({ isReloading: false, runtimeOperation: "idle" });
    });

    it("重载失败回滚后恢复 readiness 状态", async () => {
        const initAdapters = vi
            .fn()
            .mockImplementationOnce(() => {
                throw new Error("新配置初始化失败");
            })
            .mockImplementationOnce(() => undefined);
        const app = {
            config,
            isReloading: false,
            isStarted: false,
            adapters: new Map(),
            logger: { level: "info" },
            enhancedLogger: { setLevel: vi.fn() },
            stopAdapters: vi.fn(async () => undefined),
            initAdapters,
            startAdapters: vi.fn(),
        } as unknown as BaseApp;

        await expect(
            BaseApp.prototype.reload.call(app, { ...config, access_token: "next-token" }),
        ).rejects.toThrow("新配置初始化失败");
        expect(app.isReloading).toBe(false);
        expect(app.config.access_token).toBe("token");
        expect(initAdapters).toHaveBeenCalledTimes(2);
    });

    it("新适配器异步启动失败时恢复旧配置与旧适配器", async () => {
        const stopAdapters = vi.fn(async () => undefined);
        const startAdapters = vi
            .fn()
            .mockRejectedValueOnce(new Error("新适配器启动失败"))
            .mockResolvedValueOnce(undefined);
        const app = {
            config,
            isReloading: false,
            isStarted: true,
            adapters: new Map(),
            logger: { level: "info" },
            enhancedLogger: { setLevel: vi.fn() },
            stopAdapters,
            initAdapters: vi.fn(),
            startAdapters,
        } as unknown as BaseApp;

        await expect(
            BaseApp.prototype.reload.call(app, { ...config, access_token: "next-token" }),
        ).rejects.toThrow("新适配器启动失败");
        expect(app.config.access_token).toBe("token");
        expect(app.isReloading).toBe(false);
        expect(stopAdapters).toHaveBeenNthCalledWith(1, true);
        expect(stopAdapters).toHaveBeenNthCalledWith(2, true);
        expect(app.initAdapters).toHaveBeenCalledTimes(2);
        expect(startAdapters).toHaveBeenNthCalledWith(1, true);
        expect(startAdapters).toHaveBeenNthCalledWith(2, true);
    });

    it("旧适配器停止失败时不切换配置或构造新运行态", async () => {
        const initAdapters = vi.fn();
        const startAdapters = vi.fn();
        const app = {
            config,
            isReloading: false,
            isStarted: true,
            adapters: new Map(),
            logger: { level: "info" },
            enhancedLogger: { setLevel: vi.fn() },
            stopAdapters: vi.fn(async () => {
                throw new Error("旧适配器停止失败");
            }),
            initAdapters,
            startAdapters,
        } as unknown as BaseApp;

        await expect(
            BaseApp.prototype.reload.call(app, { ...config, access_token: "next-token" }),
        ).rejects.toMatchObject({
            message: "旧适配器停止失败",
            context: expect.objectContaining({ phase: "stop-previous" }),
        });
        expect(app.config.access_token).toBe("token");
        expect(app.isReloading).toBe(false);
        expect(initAdapters).not.toHaveBeenCalled();
        expect(startAdapters).not.toHaveBeenCalled();
    });

    it("旧运行态恢复失败时同时保留新配置错误与回滚错误", async () => {
        const startAdapters = vi
            .fn()
            .mockRejectedValueOnce(new Error("新适配器启动失败"))
            .mockRejectedValueOnce(new Error("旧适配器恢复失败"));
        const app = {
            config,
            isReloading: false,
            isStarted: true,
            adapters: new Map(),
            logger: { level: "info" },
            enhancedLogger: { setLevel: vi.fn() },
            stopAdapters: vi.fn(async () => undefined),
            initAdapters: vi.fn(),
            startAdapters,
        } as unknown as BaseApp;

        const error = await BaseApp.prototype.reload
            .call(app, { ...config, access_token: "next-token" })
            .catch(value => value);

        expect(error).toMatchObject({
            message: "配置重载失败且运行态回滚未完整完成",
            cause: expect.objectContaining({
                errors: [
                    expect.objectContaining({ message: "新适配器启动失败" }),
                    expect.objectContaining({ message: "旧适配器恢复失败" }),
                ],
            }),
        });
        expect(app.config.access_token).toBe("token");
        expect(app.isReloading).toBe(false);
    });
});

async function routeMarker(port: number, path: string): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = (await response.json()) as { marker: string };
    return body.marker;
}
