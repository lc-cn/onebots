import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import type { RouterContext } from "@onebots/core";
import type { App } from "../app.js";
import {
    ExtensionCatalogIntegrityError,
    ExtensionInstallConflictError,
    ExtensionRuntimeConfigError,
} from "../extension-manager.js";
import { registerExtensionRoutes } from "./extensions.js";
import { MANAGEMENT_EXPECTED_INSTANCE_HEADER } from "../management-instance-precondition.js";
import { MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER } from "../management-config-revision.js";

type RouteHandler = (ctx: RouterContext) => void | Promise<void>;
const configPath = fileURLToPath(new URL("../config.sample.yaml", import.meta.url));

function postContext(
    headers: Record<string, string> = {},
): RouterContext & { set: ReturnType<typeof vi.fn> } {
    return {
        params: { id: "adapter:slack" },
        get: (name: string) => headers[name] ?? "",
        set: vi.fn(),
    } as unknown as RouterContext & { set: ReturnType<typeof vi.fn> };
}

function setup(
    install = vi.fn(async () => ({ restartRequired: true as const })),
    restartSupported = true,
) {
    const gets = new Map<string, RouteHandler>();
    const posts = new Map<string, RouteHandler>();
    const app = {
        pluginInfos: [],
        extensionManager: {
            list: vi.fn(() => [{ id: "adapter:slack" }]),
            packageMutationStatus: vi.fn(() => ({
                state: "idle",
                available: true,
                owner: null,
                error: null,
            })),
            install,
        },
        logger: { error: vi.fn() },
        configPath,
        restartSupported,
        runtimeContractId: "sha256:contract-a",
        info: {
            application_name: "onebots",
            application_version: "1.2.8",
            instance_id: "instance-a",
        },
    } as unknown as App;
    registerExtensionRoutes(app, {
        get: vi.fn((route: string, handler: RouteHandler) => gets.set(route, handler)),
        post: vi.fn((route: string, handler: RouteHandler) => posts.set(route, handler)),
    } as never);
    return { app, gets, posts, install };
}

describe("extension routes", () => {
    it("返回带安装状态的白名单目录", () => {
        const { app, gets } = setup();
        const ctx = { set: vi.fn() } as unknown as RouterContext;

        gets.get("/api/extensions")!(ctx);

        expect(ctx.body).toEqual([{ id: "adapter:slack", restartSupported: true }]);
        expect(app.extensionManager.list).toHaveBeenCalledWith(
            [],
            expect.stringContaining("general:"),
        );
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Runtime-Contract-Id", "sha256:contract-a");
        expect(ctx.set).toHaveBeenCalledWith(
            "X-OneBots-Config-Revision",
            expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        );
        expect(ctx.set).toHaveBeenCalledWith("Cache-Control", "no-store");
    });

    it("从独立端点返回不含所有权凭据的跨进程包变更状态", () => {
        const { app, gets } = setup();
        const ctx = { set: vi.fn() } as unknown as RouterContext;

        gets.get("/api/extensions/package-mutation")!(ctx);

        expect(app.extensionManager.packageMutationStatus).toHaveBeenCalledOnce();
        expect(ctx.body).toEqual({ state: "idle", available: true, owner: null, error: null });
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
    });

    it("安装固定扩展并明确要求重启", async () => {
        const { posts, install } = setup();
        const ctx = postContext();

        await posts.get("/api/extensions/:id/install")!(ctx);

        expect(install).toHaveBeenCalledWith("adapter:slack");
        expect(ctx.body).toMatchObject({
            success: true,
            restartRequired: true,
            restartSupported: true,
            application: "onebots",
            instance_id: "instance-a",
            config_revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        });
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
    });

    it("拒绝由旧实例或过期配置快照发起的安装", async () => {
        const { posts, install } = setup();
        const staleInstance = postContext({
            [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: "instance-old",
        });
        await posts.get("/api/extensions/:id/install")!(staleInstance);
        expect(staleInstance.status).toBe(409);
        expect(staleInstance.body).toMatchObject({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            message: expect.stringContaining("当前已由实例 instance-a 接管"),
        });

        const staleRevision = postContext({
            [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: "instance-a",
            [MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER]: `sha256:${"0".repeat(64)}`,
        });
        await posts.get("/api/extensions/:id/install")!(staleRevision);
        expect(staleRevision.status).toBe(409);
        expect(staleRevision.body).toMatchObject({
            success: false,
            message: "扩展安装使用的配置已经过期，请重新读取后再操作",
        });
        expect(install).not.toHaveBeenCalled();
    });

    it("前台运行时完成安装但要求用户手动重启", async () => {
        const { posts } = setup(undefined, false);
        const ctx = postContext();

        await posts.get("/api/extensions/:id/install")!(ctx);

        expect(ctx.body).toMatchObject({
            success: true,
            restartRequired: true,
            restartSupported: false,
            message: expect.stringContaining("请手动重启 OneBots"),
        });
    });

    it("并发安装返回 409", async () => {
        const install = vi.fn(async () => {
            throw new ExtensionInstallConflictError("正在安装");
        });
        const { posts } = setup(install);
        const ctx = postContext();

        await posts.get("/api/extensions/:id/install")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            message: "正在安装",
        });
    });

    it("目录完整性失败返回可重试的服务不可用状态", async () => {
        const install = vi.fn(async () => {
            throw new ExtensionCatalogIntegrityError("扩展目录完整性校验失败");
        });
        const { posts } = setup(install);
        const ctx = postContext();

        await posts.get("/api/extensions/:id/install")!(ctx);

        expect(ctx.status).toBe(503);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            message: "扩展目录完整性校验失败",
        });
    });

    it("启动配置损坏时返回可修复的语义错误", async () => {
        const install = vi.fn(async () => {
            throw new ExtensionRuntimeConfigError("扩展启动配置无法读取：plugins 必须是对象");
        });
        const { posts } = setup(install);
        const ctx = postContext();

        await posts.get("/api/extensions/:id/install")!(ctx);

        expect(ctx.status).toBe(422);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            message: "扩展启动配置无法读取：plugins 必须是对象",
        });
    });

    it("响应与日志共用脱敏后的安装错误", async () => {
        const install = vi.fn(async () => {
            throw new Error("fetch https://user:secret@registry.example/pkg?token=secret");
        });
        const { app, posts } = setup(install);
        const ctx = postContext();

        await posts.get("/api/extensions/:id/install")!(ctx);

        const message = "fetch https://***@registry.example/pkg?token=***";
        expect(ctx.status).toBe(500);
        expect(ctx.body).toEqual({
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            message,
        });
        expect(app.logger.error).toHaveBeenCalledWith("管理端安装扩展失败", {
            error: message,
        });
    });
});
