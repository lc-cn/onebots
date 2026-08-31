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
import { BaseApp } from "./base-app.js";

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
            expect(health.status).toBe(200);
            await expect(health.json()).resolves.toMatchObject({
                application: "embedded-gateway",
                version: "9.8.7",
                core_version: expect.any(String),
            });
            expect(app.info).toMatchObject({
                application_name: "embedded-gateway",
                application_version: "9.8.7",
                core_version: expect.any(String),
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

    it("账号配置成功落盘后通知宿主更新已应用快照", async () => {
        const originalConfigDir = BaseApp.configDir;
        const directory = mkdtempSync(join(tmpdir(), "onebots-persist-hook-"));
        BaseApp.configDir = directory;
        const account = { start: vi.fn(async () => undefined) };
        const adapter = {
            createAccount: vi.fn(() => account),
            accounts: new Map(),
        };
        const onConfigPersisted = vi.fn();
        const app = {
            config: { ...config },
            isStarted: false,
            findOrCreateAdapter: vi.fn(() => adapter),
            onConfigPersisted,
        } as unknown as BaseApp;

        try {
            await BaseApp.prototype.addAccount.call(app, {
                platform: "mock",
                account_id: "primary",
            });

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
        await expect(BaseApp.prototype.reload.call(app, config)).rejects.toThrow("配置正在重载");

        releaseStop?.();
        await firstReload;
        expect(app.isReloading).toBe(false);
        expect(app.config.access_token).toBe("next-token");
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
});
