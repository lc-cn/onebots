import { AccountMutationConflictError, RouterContext, ValidationError } from "@onebots/core";
import type { Adapter, Router } from "@onebots/core";
import type { App } from "../app.js";
import {
    executeManagementAccountLifecycle,
    type ManagementAccountLifecycleAction,
} from "../management-account-lifecycle.js";
import { setManagementEvidenceIdentity } from "../management-evidence-identity.js";
import {
    assertManagementInstancePrecondition,
    ManagementInstanceMismatchError,
} from "../management-instance-precondition.js";
import {
    assertManagementConfigRevisionPrecondition,
    ManagementConfigRevisionMismatchError,
} from "../management-config-revision.js";

/**
 * Register adapter / account management and message-sending routes.
 *
 * Routes in this group:
 *  GET  /api/adapters       — list all adapter infos
 *  GET  /api/adapter-capabilities — list runtime and catalog capability evidence
 *  GET  /api/list           — list all account infos
 *  POST /api/add            — add an account
 *  POST /api/edit           — update an account
 *  POST /api/remove         — remove an account
 *  GET  /api/remove         — deprecated compatibility entry for account removal
 *  POST /api/bots/start     — set a bot online
 *  POST /api/bots/stop      — set a bot offline
 *  POST /api/send           — send a message through a running gateway
 */
export function registerAdapterRoutes(app: App, router: Router): void {
    router.get("/api/adapters", (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        ctx.body = app.adapterInfos;
    });

    router.get("/api/adapter-capabilities", (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        ctx.body = app.adapterCapabilityReport;
    });

    router.get("/api/list", (ctx: RouterContext) => {
        ctx.body = app.accounts.map(bot => bot.info);
    });

    router.post("/api/add", async (ctx: RouterContext) => {
        const config = ctx.request.body;
        try {
            assertManagementInstancePrecondition(app, ctx, "账号新增");
            assertManagementConfigRevisionPrecondition(ctx, "账号新增", app.configPath);
            await app.addAccount(config);
            ctx.body = { success: true, message: "添加成功" };
        } catch (error) {
            ctx.status = accountMutationStatus(error);
            ctx.body = { success: false, message: (error as Error).message };
            app.logger.error("管理端新增账号失败", { error });
        }
    });

    router.post("/api/edit", async (ctx: RouterContext) => {
        const config = ctx.request.body;
        try {
            assertManagementInstancePrecondition(app, ctx, "账号编辑");
            assertManagementConfigRevisionPrecondition(ctx, "账号编辑", app.configPath);
            await app.updateAccount(config);
            ctx.body = { success: true, message: "修改成功" };
        } catch (error) {
            ctx.status = accountMutationStatus(error);
            ctx.body = { success: false, message: (error as Error).message };
            app.logger.error("管理端编辑账号失败", { error });
        }
    });

    router.post("/api/remove", async (ctx: RouterContext) => {
        await handleAccountRemoval(app, ctx, () => {
            const body = requiredBodyRecord(ctx.request.body);
            return {
                platform: requiredBodyString("platform", body.platform),
                uin: requiredBodyString("uin", body.uin),
                force: optionalBodyBoolean("force", body.force),
            };
        });
    });

    router.get("/api/remove", async (ctx: RouterContext) => {
        ctx.set("Cache-Control", "no-store");
        ctx.set("Deprecation", "@1788307200");
        ctx.set(
            "Warning",
            '299 OneBots "GET /api/remove is deprecated; use POST with a JSON body"',
        );
        await handleAccountRemoval(app, ctx, () => {
            const { uin, platform, force } = ctx.request.query;
            return {
                platform: requiredQueryString("platform", platform),
                uin: requiredQueryString("uin", uin),
                force: parseBooleanQuery(force),
            };
        });
    });

    router.post("/api/bots/start", async (ctx: RouterContext) => {
        await handleAccountLifecycleRequest(app, ctx, "bot.start");
    });

    router.post("/api/bots/stop", async (ctx: RouterContext) => {
        await handleAccountLifecycleRequest(app, ctx, "bot.stop");
    });

    // CLI send：通过已运行网关发信
    router.post("/api/send", async (ctx: RouterContext) => {
        try {
            const body = (ctx.request.body as Record<string, unknown>) || {};
            const channel = String(body.channel ?? "");
            const target_id = String(body.target_id ?? "");
            const target_type = String(body.target_type ?? "private") as
                | "private"
                | "group"
                | "channel";
            const message = String(body.message ?? "");

            if (!channel || !target_id) {
                ctx.status = 400;
                ctx.body = { success: false, message: "缺少 channel 或 target_id" };
                return;
            }

            const parts = channel.split(".");
            const platform = parts[0];
            const account_id = parts.slice(1).join(".") || parts[1];

            if (!platform || !account_id) {
                ctx.status = 400;
                ctx.body = { success: false, message: "channel 格式应为 platform.account_id" };
                return;
            }

            const adapter = app.adapters.get(platform as keyof Adapter.Configs);
            if (!adapter) {
                ctx.status = 404;
                ctx.body = { success: false, message: `适配器 ${platform} 不存在` };
                return;
            }

            const account = adapter.getAccount(account_id);
            if (!account) {
                ctx.status = 404;
                ctx.body = { success: false, message: `账号 ${channel} 不存在` };
                return;
            }

            const segments = [{ type: "text", data: { text: message } }];
            const scene_id = adapter.createId(target_id);
            const result = await adapter.sendMessage(account_id, {
                scene_type: target_type,
                scene_id,
                message: segments,
            });
            ctx.body = { success: true, message_id: result?.message_id ?? null };
        } catch (error: unknown) {
            const err = error as Error;
            ctx.status = 500;
            ctx.body = { success: false, message: err?.message ?? "发送失败" };
        }
    });
}

interface AccountRemovalRequest {
    platform: string;
    uin: string;
    force: boolean;
}

async function handleAccountRemoval(
    app: App,
    ctx: RouterContext,
    readRequest: () => AccountRemovalRequest,
): Promise<void> {
    try {
        assertManagementInstancePrecondition(app, ctx, "账号删除");
        assertManagementConfigRevisionPrecondition(ctx, "账号删除", app.configPath);
        const request = readRequest();
        await app.removeAccount(request.platform, request.uin, request.force);
        ctx.set("Cache-Control", "no-store");
        ctx.body = { success: true, message: "移除成功" };
    } catch (error) {
        ctx.status = accountMutationStatus(error);
        ctx.body = { success: false, message: (error as Error).message };
        app.logger.error("管理端删除账号失败", { error });
    }
}

function parseBooleanQuery(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(item => parseBooleanQuery(item));
    if (typeof value !== "string") return value === true;
    return value === "1" || value.toLowerCase() === "true";
}

function requiredQueryString(field: string, value: unknown): string {
    if (Array.isArray(value)) value = value[0];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new ValidationError(`查询参数 ${field} 必须是非空字符串`);
    }
    return value;
}

function requiredBodyRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ValidationError("账号删除请求体必须是对象");
    }
    return value as Record<string, unknown>;
}

function requiredBodyString(field: string, value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new ValidationError(`请求字段 ${field} 必须是非空字符串`);
    }
    return value;
}

function optionalBodyBoolean(field: string, value: unknown): boolean {
    if (value === undefined) return false;
    if (typeof value !== "boolean") throw new ValidationError(`请求字段 ${field} 必须是布尔值`);
    return value;
}

function accountMutationStatus(error: unknown): number {
    if (error instanceof ManagementInstanceMismatchError) return 409;
    if (error instanceof ManagementConfigRevisionMismatchError) return 409;
    if (error instanceof AccountMutationConflictError) return 409;
    if (error instanceof ValidationError) return 400;
    return 500;
}

async function handleAccountLifecycleRequest(
    app: App,
    ctx: RouterContext,
    action: ManagementAccountLifecycleAction,
): Promise<void> {
    const result = await executeManagementAccountLifecycle(app, action, ctx.request.body);
    if (result.success === true) {
        ctx.body = { success: true, data: result.account };
        return;
    }
    ctx.status = result.status;
    ctx.body = { success: false, code: result.code, message: result.message };
}
