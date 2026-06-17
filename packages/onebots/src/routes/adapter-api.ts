import { RouterContext } from "@onebots/core";
import type { Router, Adapter } from "@onebots/core";
import type { App } from "../app.js";

/**
 * Register adapter / account management and message-sending routes.
 *
 * Routes in this group:
 *  GET  /api/adapters       — list all adapter infos
 *  GET  /api/list           — list all account infos
 *  POST /api/add            — add an account
 *  POST /api/edit           — update an account
 *  GET  /api/remove         — remove an account
 *  POST /api/bots/start     — set a bot online
 *  POST /api/bots/stop      — set a bot offline
 *  POST /api/send           — send a message through a running gateway
 */
export function registerAdapterRoutes(app: App, router: Router): void {
    router.get("/api/adapters", (ctx: RouterContext) => {
        ctx.body = [...app.adapters.values()].map(adapter => adapter.info);
    });

    router.get("/api/list", (ctx: RouterContext) => {
        ctx.body = app.accounts.map(bot => bot.info);
    });

    router.post("/api/add", (ctx: RouterContext) => {
        const config = ctx.request.body;
        try {
            app.addAccount(config);
            ctx.body = { success: true, message: '添加成功' };
        } catch (e) {
            ctx.status = 500;
            ctx.body = { success: false, message: (e as Error).message };
        }
    });

    router.post("/api/edit", async (ctx: RouterContext) => {
        const config = ctx.request.body;
        try {
            await app.updateAccount(config);
            ctx.body = { success: true, message: '修改成功' };
        } catch (e) {
            ctx.status = 500;
            ctx.body = { success: false, message: (e as Error).message };
        }
    });

    router.get("/api/remove", async (ctx: RouterContext) => {
        const { uin, platform, force } = ctx.request.query;
        try {
            await app.removeAccount(String(platform), String(uin), Boolean(force));
            ctx.body = { success: true, message: '移除成功' };
        } catch (e) {
            ctx.status = 500;
            ctx.body = { success: false, message: (e as Error).message };
        }
    });

    router.post("/api/bots/start", async (ctx: RouterContext) => {
        const { platform, uin } = ctx.request.body as { platform: string; uin: string };
        try {
            const adapter = app.adapters.get(platform as keyof Adapter.Configs);
            await adapter?.setOnline(uin);
            ctx.body = { success: true, data: adapter?.getAccount(uin)?.info };
        } catch (e) {
            ctx.status = 500;
            ctx.body = { success: false, message: (e as Error).message };
        }
    });

    router.post("/api/bots/stop", async (ctx: RouterContext) => {
        const { platform, uin } = ctx.request.body as { platform: string; uin: string };
        try {
            const adapter = app.adapters.get(platform as keyof Adapter.Configs);
            await adapter?.setOffline(uin);
            ctx.body = { success: true, data: adapter?.getAccount(uin)?.info };
        } catch (e) {
            ctx.status = 500;
            ctx.body = { success: false, message: (e as Error).message };
        }
    });

    // CLI send：通过已运行网关发信
    router.post("/api/send", async (ctx: RouterContext) => {
        try {
            const body = (ctx.request.body as Record<string, unknown>) || {};
            const channel = String(body.channel ?? "");
            const target_id = String(body.target_id ?? "");
            const target_type = String(body.target_type ?? "private") as "private" | "group" | "channel";
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
        } catch (e: unknown) {
            const err = e as Error;
            ctx.status = 500;
            ctx.body = { success: false, message: err?.message ?? "发送失败" };
        }
    });
}
