import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertHostConfigReloadable, resolveListenPort } from "./app-reload.js";
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

    it("将 PORT 环境变量解析为 TCP 端口并拒绝非数字值", () => {
        expect(resolveListenPort(6727, "8080")).toBe(8080);
        expect(resolveListenPort(6727, undefined)).toBe(6727);
        expect(() => resolveListenPort(6727, "socket-name")).toThrow("PORT 必须是");
    });

    it("运行态热重载保留 HTTP、Router 与生命周期资源", async () => {
        const originalConfigDir = BaseApp.configDir;
        const originalPort = process.env.PORT;
        const directory = mkdtempSync(join(tmpdir(), "onebots-reload-"));
        BaseApp.configDir = directory;
        process.env.PORT = "0";
        const app = new BaseApp({ database: "reload.db" });

        try {
            await app.start();
            const server = app.httpServer;
            const router = app.router;
            const middlewareCount = app.middleware.length;
            const resourceCount = app.lifecycle.getResourceCount();

            await app.reload({ ...app.config, access_token: "next-token", log_level: "debug" });

            expect(app.httpServer).toBe(server);
            expect(app.httpServer.listening).toBe(true);
            expect(app.router).toBe(router);
            expect(app.middleware).toHaveLength(middlewareCount);
            expect(app.lifecycle.getResourceCount()).toBe(resourceCount);
            expect(app.config.access_token).toBe("next-token");

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
});
