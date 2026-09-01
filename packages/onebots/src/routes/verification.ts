import { RouterContext, ValidationError } from "@onebots/core";
import type { Router, Adapter } from "@onebots/core";
import type { App } from "../app.js";
import { startManagementAuthorizationMonitor } from "../management-authorization-monitor.js";
import { prepareManagementEventStream } from "../management-event-stream-response.js";
import { setManagementEvidenceIdentity } from "../management-evidence-identity.js";
import {
    assertManagementInstancePrecondition,
    ManagementInstanceMismatchError,
} from "../management-instance-precondition.js";

/**
 * Register verification-related routes for adapter login flows (device lock, SMS, etc.).
 *
 * Routes:
 *  GET  /api/verification/stream       — SSE endpoint; pushes verification events to the web UI
 *  GET  /api/verification/pending      — returns pending verification requests
 *  POST /api/verification/request-sms  — ask the adapter to send an SMS code
 *  POST /api/verification/submit       — submit a completed verification (slider, SMS, …)
 *
 * Verification-event broadcasting is wired by the App class lifecycle hooks
 * (onAdapterCreated / the adapter subscription loop) — this module only
 * handles the HTTP / SSE endpoints.
 */
export function registerVerificationRoutes(app: App, router: Router): void {
    // 验证流 SSE 端点（登录验证事件推送到 Web）
    router.get("/api/verification/stream", (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        prepareManagementEventStream(ctx);
        try {
            ctx.res.write(
                `data: ${JSON.stringify({
                    event: "identity",
                    application: app.info.application_name,
                    version: app.info.application_version,
                    instance_id: app.info.instance_id,
                    ...(app.runtimeContractId
                        ? { runtime_contract_id: app.runtimeContractId }
                        : {}),
                })}\n\n`,
            );
        } catch (error) {
            app.logger.error("发送账号验证流身份失败", { error });
            ctx.res.end();
            return;
        }

        const stopAuthorizationMonitor = startManagementAuthorizationMonitor(
            app,
            ctx.state.token as string | undefined,
            {
                onAuthorized: () => {
                    try {
                        ctx.res.write(": heartbeat\n\n");
                    } catch (error) {
                        app.logger.error("发送账号验证流心跳失败", { error });
                        app.removeVerificationClient(ctx.res);
                    }
                },
                onUnauthorized: () => {
                    app.removeVerificationClient(ctx.res);
                    ctx.res.end();
                },
            },
        );
        app.registerVerificationClient(ctx.res, stopAuthorizationMonitor);

        ctx.req.on("close", () => {
            app.removeVerificationClient(ctx.res);
        });
    });

    // 待处理验证列表（Web 打开页面时拉取，避免离线期间错过验证）
    router.get("/api/verification/pending", (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        ctx.body = app.getPendingVerificationList();
    });

    // 请求发送短信验证码（设备锁带手机号时，用户选短信验证前调用）
    router.post("/api/verification/request-sms", async (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        try {
            assertManagementInstancePrecondition(app, ctx, "短信验证码请求");
            const body = (ctx.request.body as { platform?: string; account_id?: string }) || {};
            const platform = String(body.platform ?? "");
            const account_id = String(body.account_id ?? "");
            if (!platform || !account_id) {
                ctx.status = 400;
                ctx.body = verificationFailure(app, "缺少 platform 或 account_id");
                return;
            }
            const adapter = app.adapters.get(platform as keyof Adapter.Configs);
            if (!adapter) {
                ctx.status = 404;
                ctx.body = verificationFailure(app, `适配器 ${platform} 不存在`);
                return;
            }
            const requestSms = (adapter as { requestSmsCode?(a: string): void | Promise<void> })
                .requestSmsCode;
            if (typeof requestSms !== "function") {
                ctx.status = 501;
                ctx.body = verificationFailure(app, `适配器 ${platform} 不支持请求短信验证码`);
                return;
            }
            await Promise.resolve(requestSms.call(adapter, account_id));
            ctx.body = verificationSuccess(app);
        } catch (error) {
            ctx.status = verificationErrorStatus(error);
            ctx.body = verificationFailure(
                app,
                error instanceof Error ? error.message : "请求失败",
            );
            app.logger.error("管理端请求短信验证码失败", { error });
        }
    });

    // 验证提交接口（Web 完成滑块/短信等后提交）
    router.post("/api/verification/submit", async (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        try {
            assertManagementInstancePrecondition(app, ctx, "账号验证提交");
            const body =
                (ctx.request.body as {
                    platform?: string;
                    account_id?: string;
                    type?: string;
                    data?: Record<string, unknown>;
                }) || {};
            const platform = String(body.platform ?? "");
            const account_id = String(body.account_id ?? "");
            const type = String(body.type ?? "");
            const data = body.data && typeof body.data === "object" ? body.data : {};

            if (!platform || !account_id || !type) {
                ctx.status = 400;
                ctx.body = verificationFailure(app, "缺少 platform、account_id 或 type");
                return;
            }

            const adapter = app.adapters.get(platform as keyof Adapter.Configs);
            if (!adapter) {
                ctx.status = 404;
                ctx.body = verificationFailure(app, `适配器 ${platform} 不存在`);
                return;
            }

            const submit = (
                adapter as {
                    submitVerification?(
                        a: string,
                        t: string,
                        d: Record<string, unknown>,
                    ): void | Promise<void>;
                }
            ).submitVerification;
            if (typeof submit !== "function") {
                ctx.status = 501;
                ctx.body = verificationFailure(app, `适配器 ${platform} 不支持 Web 验证提交`);
                return;
            }

            await Promise.resolve(submit.call(adapter, account_id, type, data));
            app.pendingVerifications.delete(`${platform}:${account_id}:${type}`);
            ctx.body = verificationSuccess(app);
        } catch (error) {
            ctx.status = verificationErrorStatus(error);
            ctx.body = verificationFailure(
                app,
                error instanceof Error ? error.message : "提交失败",
            );
            app.logger.error("管理端提交账号验证失败", { error });
        }
    });
}

function verificationSuccess(app: App) {
    return {
        success: true,
        application: app.info.application_name,
        instance_id: app.info.instance_id,
    };
}

function verificationFailure(app: App, message: string) {
    return { ...verificationSuccess(app), success: false, message };
}

function verificationErrorStatus(error: unknown): number {
    if (error instanceof ManagementInstanceMismatchError) return 409;
    if (error instanceof ValidationError) return 400;
    return 500;
}
