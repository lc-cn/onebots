import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseApp, ConfigRestartRequiredError, TokenManager } from "@onebots/core";
import { App } from "./app.js";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe("App management credential reload", () => {
    it("插件默认选择变化时要求重启而不伪装成热重载成功", async () => {
        const reload = vi.spyOn(BaseApp.prototype, "reload");
        const app = {
            config: { plugins: { adapters: ["mock"], protocols: ["onebot-v11"] } },
        } as unknown as App;

        await expect(
            App.prototype.reload.call(app, {
                plugins: { adapters: ["qq"], protocols: ["onebot-v11"] },
            }),
        ).rejects.toMatchObject({
            name: "ConfigRestartRequiredError",
            changed: ["plugins"],
        } satisfies Partial<ConfigRestartRequiredError>);
        expect(reload).not.toHaveBeenCalled();
    });

    it("凭据轮换后撤销会话并关闭现有管理连接", async () => {
        mockBaseReload();
        const tokenManager = new TokenManager();
        const session = tokenManager.generateToken({ username: "admin" });
        const managementClient = { close: vi.fn() };
        const terminalClient = { close: vi.fn() };
        const logStreams = { disconnectClients: vi.fn(() => []) };
        const verificationStreams = { disconnectClients: vi.fn(() => []) };
        const messageDebugStreams = { disconnectClients: vi.fn(() => []) };
        const app = {
            config: {
                username: "admin",
                password: "old-password",
                access_token: "old-token",
            },
            tokenManager,
            ws: { clients: new Set([managementClient]) },
            terminalClients: new Set([terminalClient]),
            _logCache: logStreams,
            _verification: verificationStreams,
            _messageDebug: messageDebugStreams,
            disconnectManagementStreams: () => [
                ...logStreams.disconnectClients(),
                ...verificationStreams.disconnectClients(),
                ...messageDebugStreams.disconnectClients(),
            ],
        } as unknown as App;

        await App.prototype.reload.call(app, {
            username: "admin",
            password: "new-password",
            access_token: "new-token",
        });
        await new Promise<void>(resolve => setImmediate(resolve));

        expect(tokenManager.validateToken(session.token).valid).toBe(false);
        expect(managementClient.close).toHaveBeenCalledWith(1008, "Credentials changed");
        expect(terminalClient.close).toHaveBeenCalledWith(1008, "Credentials changed");
        expect(logStreams.disconnectClients).toHaveBeenCalledOnce();
        expect(verificationStreams.disconnectClients).toHaveBeenCalledOnce();
        expect(messageDebugStreams.disconnectClients).toHaveBeenCalledOnce();
    });

    it("非认证配置热重载保留现有会话与连接", async () => {
        mockBaseReload();
        const tokenManager = new TokenManager();
        const session = tokenManager.generateToken({ username: "admin" });
        const managementClient = { close: vi.fn() };
        const app = {
            config: {
                username: "admin",
                password: "password",
                access_token: "token",
                log_level: "info",
            },
            tokenManager,
            ws: { clients: new Set([managementClient]) },
            terminalClients: new Set(),
        } as unknown as App;

        await App.prototype.reload.call(app, {
            username: "admin",
            password: "password",
            access_token: "token",
            log_level: "debug",
        });
        await new Promise<void>(resolve => setImmediate(resolve));

        expect(tokenManager.validateToken(session.token).valid).toBe(true);
        expect(managementClient.close).not.toHaveBeenCalled();
    });

    it("环境 token 生效时文件 token 变化不撤销仍有效的管理会话", async () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "deployment-token");
        mockBaseReload();
        const tokenManager = new TokenManager();
        const session = tokenManager.generateToken({ username: "admin" });
        const managementClient = { close: vi.fn() };
        const app = {
            config: { access_token: "old-file-token" },
            tokenManager,
            ws: { clients: new Set([managementClient]) },
            terminalClients: new Set(),
        } as unknown as App;

        await App.prototype.reload.call(app, { access_token: "new-file-token" });
        await new Promise<void>(resolve => setImmediate(resolve));

        expect(tokenManager.validateToken(session.token).valid).toBe(true);
        expect(managementClient.close).not.toHaveBeenCalled();
    });
});

function mockBaseReload(): void {
    vi.spyOn(BaseApp.prototype, "reload").mockImplementation(async function (config) {
        this.config = { ...BaseApp.defaultConfig, ...config } as Required<BaseApp.Config>;
    });
}
