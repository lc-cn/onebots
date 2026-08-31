import { describe, expect, it, vi } from "vitest";
import type { RouterContext } from "@onebots/core";
import type { App } from "../app.js";
import {
    ExtensionCatalogIntegrityError,
    ExtensionInstallConflictError,
} from "../extension-manager.js";
import { registerExtensionRoutes } from "./extensions.js";

type RouteHandler = (ctx: RouterContext) => void | Promise<void>;

function setup(install = vi.fn(async () => ({ restartRequired: true as const }))) {
    const gets = new Map<string, RouteHandler>();
    const posts = new Map<string, RouteHandler>();
    const app = {
        pluginInfos: [],
        extensionManager: { list: vi.fn(() => [{ id: "adapter:slack" }]), install },
        logger: { error: vi.fn() },
    } as unknown as App;
    registerExtensionRoutes(app, {
        get: vi.fn((route: string, handler: RouteHandler) => gets.set(route, handler)),
        post: vi.fn((route: string, handler: RouteHandler) => posts.set(route, handler)),
    } as never);
    return { app, gets, posts, install };
}

describe("extension routes", () => {
    it("返回带安装状态的白名单目录", () => {
        const { gets } = setup();
        const ctx = {} as RouterContext;

        gets.get("/api/extensions")!(ctx);

        expect(ctx.body).toEqual([{ id: "adapter:slack" }]);
    });

    it("安装固定扩展并明确要求重启", async () => {
        const { posts, install } = setup();
        const ctx = { params: { id: "adapter:slack" } } as unknown as RouterContext;

        await posts.get("/api/extensions/:id/install")!(ctx);

        expect(install).toHaveBeenCalledWith("adapter:slack");
        expect(ctx.body).toMatchObject({ success: true, restartRequired: true });
    });

    it("并发安装返回 409", async () => {
        const install = vi.fn(async () => {
            throw new ExtensionInstallConflictError("正在安装");
        });
        const { posts } = setup(install);
        const ctx = { params: { id: "adapter:slack" } } as unknown as RouterContext;

        await posts.get("/api/extensions/:id/install")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({ success: false, message: "正在安装" });
    });

    it("目录完整性失败返回可重试的服务不可用状态", async () => {
        const install = vi.fn(async () => {
            throw new ExtensionCatalogIntegrityError("扩展目录完整性校验失败");
        });
        const { posts } = setup(install);
        const ctx = { params: { id: "adapter:slack" } } as unknown as RouterContext;

        await posts.get("/api/extensions/:id/install")!(ctx);

        expect(ctx.status).toBe(503);
        expect(ctx.body).toEqual({ success: false, message: "扩展目录完整性校验失败" });
    });

    it("响应与日志共用脱敏后的安装错误", async () => {
        const install = vi.fn(async () => {
            throw new Error("fetch https://user:secret@registry.example/pkg?token=secret");
        });
        const { app, posts } = setup(install);
        const ctx = { params: { id: "adapter:slack" } } as unknown as RouterContext;

        await posts.get("/api/extensions/:id/install")!(ctx);

        const message = "fetch https://***@registry.example/pkg?token=***";
        expect(ctx.status).toBe(500);
        expect(ctx.body).toEqual({ success: false, message });
        expect(app.logger.error).toHaveBeenCalledWith("管理端安装扩展失败", {
            error: message,
        });
    });
});
