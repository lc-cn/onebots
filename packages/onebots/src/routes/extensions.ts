import { RouterContext } from "@onebots/core";
import type { Router } from "@onebots/core";
import type { App } from "../app.js";
import {
    ExtensionCatalogIntegrityError,
    ExtensionInstallConflictError,
    ExtensionNotFoundError,
    ExtensionRuntimeConfigError,
    formatExtensionInstallationError,
} from "../extension-manager.js";

export function registerExtensionRoutes(app: App, router: Router): void {
    router.get("/api/extensions", (ctx: RouterContext) => {
        ctx.body = app.extensionManager.list(app.pluginInfos).map(extension => ({
            ...extension,
            restartSupported: app.restartSupported,
        }));
    });

    router.get("/api/extensions/package-mutation", (ctx: RouterContext) => {
        ctx.body = app.extensionManager.packageMutationStatus();
    });

    router.post("/api/extensions/:id/install", async (ctx: RouterContext) => {
        try {
            const result = await app.extensionManager.install(String(ctx.params.id));
            ctx.body = {
                success: true,
                ...result,
                restartSupported: app.restartSupported,
                message: app.restartSupported
                    ? "扩展已安装并写入启动配置，重启后即可配置账号"
                    : "扩展已安装并写入启动配置；当前进程不会自动拉起，请手动重启 OneBots 后继续配置",
            };
        } catch (error) {
            const message = formatExtensionInstallationError(error);
            ctx.status =
                error instanceof ExtensionInstallConflictError
                    ? 409
                    : error instanceof ExtensionNotFoundError
                      ? 404
                      : error instanceof ExtensionRuntimeConfigError
                        ? 422
                        : error instanceof ExtensionCatalogIntegrityError
                          ? 503
                          : 500;
            ctx.body = { success: false, message };
            app.logger.error("管理端安装扩展失败", { error: message });
        }
    });
}
