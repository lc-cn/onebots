import { RouterContext } from "@onebots/core";
import type { Router, Adapter } from "@onebots/core";
import type { App } from "../app.js";

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
        ctx.request.socket.setTimeout(0);
        ctx.req.socket.setNoDelay(true);
        ctx.req.socket.setKeepAlive(true);
        ctx.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        ctx.status = 200;
        ctx.respond = false;

        app.verificationClients.add(ctx.res);

        const heartbeat = setInterval(() => {
            try {
                ctx.res.write(': heartbeat\n\n');
            } catch (error) {
                clearInterval(heartbeat);
                app.verificationClients.delete(ctx.res);
            }
        }, 30000);

        ctx.req.on('close', () => {
            clearInterval(heartbeat);
            app.verificationClients.delete(ctx.res);
        });
    });

    // 待处理验证列表（Web 打开页面时拉取，避免离线期间错过验证）
    router.get("/api/verification/pending", (ctx: RouterContext) => {
        ctx.body = app.getPendingVerificationList();
    });

    // 请求发送短信验证码（设备锁带手机号时，用户选短信验证前调用）
    router.post("/api/verification/request-sms", async (ctx: RouterContext) => {
        try {
            const body = (ctx.request.body as { platform?: string; account_id?: string }) || {};
            const platform = String(body.platform ?? '');
            const account_id = String(body.account_id ?? '');
            if (!platform || !account_id) {
                ctx.status = 400;
                ctx.body = { success: false, message: '缺少 platform 或 account_id' };
                return;
            }
            const adapter = app.adapters.get(platform as keyof Adapter.Configs);
            if (!adapter) {
                ctx.status = 404;
                ctx.body = { success: false, message: `适配器 ${platform} 不存在` };
                return;
            }
            const requestSms = (adapter as { requestSmsCode?(a: string): void | Promise<void> }).requestSmsCode;
            if (typeof requestSms !== 'function') {
                ctx.status = 501;
                ctx.body = { success: false, message: `适配器 ${platform} 不支持请求短信验证码` };
                return;
            }
            await Promise.resolve(requestSms.call(adapter, account_id));
            ctx.body = { success: true };
        } catch (e) {
            const err = e as Error;
            ctx.status = 500;
            ctx.body = { success: false, message: err?.message ?? '请求失败' };
        }
    });

    // 验证提交接口（Web 完成滑块/短信等后提交）
    router.post("/api/verification/submit", async (ctx: RouterContext) => {
        try {
            const body = (ctx.request.body as {
                platform?: string;
                account_id?: string;
                type?: string;
                data?: Record<string, unknown>;
            }) || {};
            const platform = String(body.platform ?? '');
            const account_id = String(body.account_id ?? '');
            const type = String(body.type ?? '');
            const data = body.data && typeof body.data === 'object' ? body.data : {};

            if (!platform || !account_id || !type) {
                ctx.status = 400;
                ctx.body = { success: false, message: '缺少 platform、account_id 或 type' };
                return;
            }

            const adapter = app.adapters.get(platform as keyof Adapter.Configs);
            if (!adapter) {
                ctx.status = 404;
                ctx.body = { success: false, message: `适配器 ${platform} 不存在` };
                return;
            }

            const submit = (adapter as { submitVerification?(a: string, t: string, d: Record<string, unknown>): void | Promise<void> }).submitVerification;
            if (typeof submit !== 'function') {
                ctx.status = 501;
                ctx.body = { success: false, message: `适配器 ${platform} 不支持 Web 验证提交` };
                return;
            }

            await Promise.resolve(submit.call(adapter, account_id, type, data));
            app.pendingVerifications.delete(`${platform}:${account_id}:${type}`);
            ctx.body = { success: true };
        } catch (e) {
            const err = e as Error;
            ctx.status = 500;
            ctx.body = { success: false, message: err?.message ?? '提交失败' };
        }
    });
}
