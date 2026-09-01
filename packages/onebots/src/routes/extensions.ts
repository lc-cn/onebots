import { RouterContext, ValidationError } from "@onebots/core";
import type { Router } from "@onebots/core";
import { readFileSync } from "node:fs";
import type { App } from "../app.js";
import {
    ExtensionCatalogIntegrityError,
    ExtensionInstallConflictError,
    ExtensionNotFoundError,
    ExtensionRuntimeConfigError,
    formatExtensionInstallationError,
} from "../extension-manager.js";
import { setManagementEvidenceIdentity } from "../management-evidence-identity.js";
import {
    assertManagementInstancePrecondition,
    ManagementInstanceMismatchError,
} from "../management-instance-precondition.js";
import {
    assertManagementConfigRevisionPrecondition,
    createManagementConfigRevision,
    ManagementConfigRevisionMismatchError,
    setManagementConfigRevision,
} from "../management-config-revision.js";

export function registerExtensionRoutes(app: App, router: Router): void {
    router.get("/api/extensions", (ctx: RouterContext) => {
        const configSource = tryReadConfigSource(app);
        setManagementEvidenceIdentity(app, ctx);
        if (configSource !== null) setManagementConfigRevision(ctx, configSource);
        ctx.body = app.extensionManager
            .list(app.pluginInfos, configSource ?? undefined)
            .map(extension => ({
                ...extension,
                restartSupported: app.restartSupported,
            }));
    });

    router.get("/api/extensions/package-mutation", (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        ctx.body = app.extensionManager.packageMutationStatus();
    });

    router.post("/api/extensions/:id/install", async (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        try {
            assertManagementInstancePrecondition(app, ctx, "扩展安装");
            assertManagementConfigRevisionPrecondition(ctx, "扩展安装", app.configPath);
            const result = await app.extensionManager.install(String(ctx.params.id));
            const configRevision = createManagementConfigRevision(
                readFileSync(app.configPath, "utf8"),
            );
            ctx.body = {
                success: true,
                ...result,
                application: app.info.application_name,
                instance_id: app.info.instance_id,
                config_revision: configRevision,
                restartSupported: app.restartSupported,
                message: app.restartSupported
                    ? "扩展已安装并写入启动配置，重启后即可配置账号"
                    : "扩展已安装并写入启动配置；当前进程不会自动拉起，请手动重启 OneBots 后继续配置",
            };
        } catch (error) {
            const message = formatExtensionInstallationError(error);
            ctx.status =
                error instanceof ManagementInstanceMismatchError ||
                error instanceof ManagementConfigRevisionMismatchError ||
                error instanceof ExtensionInstallConflictError
                    ? 409
                    : error instanceof ExtensionNotFoundError
                      ? 404
                      : error instanceof ExtensionRuntimeConfigError
                        ? 422
                        : error instanceof ExtensionCatalogIntegrityError
                          ? 503
                          : error instanceof ValidationError
                            ? 400
                            : 500;
            ctx.body = {
                success: false,
                application: app.info.application_name,
                instance_id: app.info.instance_id,
                message,
            };
            app.logger.error("管理端安装扩展失败", { error: message });
        }
    });
}

function tryReadConfigSource(app: App): string | null {
    try {
        return readFileSync(app.configPath, "utf8");
    } catch (error) {
        // ExtensionManager 会生成脱敏的运行配置诊断；此处不发布无法证明的修订号。
        app.logger.error("管理端扩展目录无法读取配置修订", { error });
        return null;
    }
}
