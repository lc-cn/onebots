import { RouterContext, ValidationError } from "@onebots/core";
import type { Router } from "@onebots/core";
import { readFileSync } from "node:fs";
import type { App } from "../app.js";
import {
    ExtensionCatalogIntegrityError,
    ExtensionInstallConflictError,
    ExtensionNotFoundError,
    ExtensionRuntimeConfigError,
    ExtensionStateConflictError,
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
            const target = String(ctx.params.id);
            const configSource = readFileSync(app.configPath, "utf8");
            const configRevision = createManagementConfigRevision(configSource);
            setManagementConfigRevision(ctx, configSource);
            ctx.body = {
                success: true,
                ...result,
                operation: "install",
                target: { id: target },
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
                code: extensionMutationFailureCode(error),
                message,
            };
            app.logger.error("管理端安装扩展失败", { error: message });
        }
    });

    router.post("/api/extensions/:id/disable", async (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        try {
            assertManagementInstancePrecondition(app, ctx, "扩展停用");
            assertManagementConfigRevisionPrecondition(ctx, "扩展停用", app.configPath);
            const result = await app.extensionManager.disable(String(ctx.params.id));
            const target = String(ctx.params.id);
            const configSource = readFileSync(app.configPath, "utf8");
            const configRevision = createManagementConfigRevision(configSource);
            setManagementConfigRevision(ctx, configSource);
            ctx.body = {
                success: true,
                ...result,
                operation: "disable",
                target: { id: target },
                application: app.info.application_name,
                instance_id: app.info.instance_id,
                config_revision: configRevision,
                restartSupported: app.restartSupported,
                message: app.restartSupported
                    ? "扩展已从启动配置移除；依赖仍保留，重启后完成停用"
                    : "扩展已从启动配置移除且依赖仍保留；请手动重启 OneBots 以完成停用",
            };
        } catch (error) {
            const message = formatExtensionInstallationError(error);
            ctx.status =
                error instanceof ManagementInstanceMismatchError ||
                error instanceof ManagementConfigRevisionMismatchError ||
                error instanceof ExtensionInstallConflictError ||
                error instanceof ExtensionStateConflictError
                    ? 409
                    : error instanceof ExtensionNotFoundError
                      ? 404
                      : error instanceof ExtensionRuntimeConfigError
                        ? 422
                        : error instanceof ValidationError
                          ? 400
                          : 500;
            ctx.body = {
                success: false,
                application: app.info.application_name,
                instance_id: app.info.instance_id,
                code: extensionMutationFailureCode(error),
                message,
            };
            app.logger.error("管理端停用扩展失败", { error: message });
        }
    });

    router.post("/api/extensions/:id/uninstall", async (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        try {
            assertManagementInstancePrecondition(app, ctx, "扩展依赖卸载");
            assertManagementConfigRevisionPrecondition(ctx, "扩展依赖卸载", app.configPath);
            const result = await app.extensionManager.uninstall(
                String(ctx.params.id),
                app.pluginInfos,
            );
            const target = String(ctx.params.id);
            const configSource = readFileSync(app.configPath, "utf8");
            const configRevision = createManagementConfigRevision(configSource);
            setManagementConfigRevision(ctx, configSource);
            ctx.body = {
                success: true,
                ...result,
                operation: "uninstall",
                target: { id: target },
                application: app.info.application_name,
                instance_id: app.info.instance_id,
                config_revision: configRevision,
                restartSupported: app.restartSupported,
                message: "扩展依赖已安全卸载；启动配置保持停用状态",
            };
        } catch (error) {
            const message = formatExtensionInstallationError(error);
            ctx.status =
                error instanceof ManagementInstanceMismatchError ||
                error instanceof ManagementConfigRevisionMismatchError ||
                error instanceof ExtensionInstallConflictError ||
                error instanceof ExtensionStateConflictError
                    ? 409
                    : error instanceof ExtensionNotFoundError
                      ? 404
                      : error instanceof ExtensionRuntimeConfigError
                        ? 422
                        : error instanceof ValidationError
                          ? 400
                          : 500;
            ctx.body = {
                success: false,
                application: app.info.application_name,
                instance_id: app.info.instance_id,
                code: extensionMutationFailureCode(error),
                message,
            };
            app.logger.error("管理端卸载扩展依赖失败", { error: message });
        }
    });
}

function extensionMutationFailureCode(error: unknown): string {
    if (error instanceof ManagementInstanceMismatchError) return "EXTENSION_INSTANCE_MISMATCH";
    if (error instanceof ManagementConfigRevisionMismatchError)
        return "EXTENSION_CONFIG_REVISION_MISMATCH";
    if (error instanceof ExtensionInstallConflictError) return "EXTENSION_BUSY";
    if (error instanceof ExtensionStateConflictError) return "EXTENSION_STATE_CONFLICT";
    if (error instanceof ExtensionNotFoundError) return "EXTENSION_NOT_FOUND";
    if (error instanceof ExtensionRuntimeConfigError) return "EXTENSION_RUNTIME_CONFIG_INVALID";
    if (error instanceof ExtensionCatalogIntegrityError) return "EXTENSION_CATALOG_UNAVAILABLE";
    if (error instanceof ValidationError) return "EXTENSION_INVALID";
    return "EXTENSION_FAILED";
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
