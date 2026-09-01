import { Account, AccountStatus } from "onebots";
import type { KookAdapter } from "./adapter.js";
import { KookBot } from "./bot.js";
import { projectKookEvents } from "./events.js";
import type { KookConfig, KookEvent, KookSignal } from "./types.js";

/** 创建 KOOK 账号，并让 Gateway 与 Webhook 共用同一条事件投影链路。 */
export function createKookAccount(
    adapter: KookAdapter,
    config: Account.Config<"kook">,
): Account<"kook", KookBot> {
    const kookConfig: KookConfig = { ...config };
    const bot = new KookBot(kookConfig);
    const account = new Account<"kook", KookBot>(adapter, bot, config);
    const baseContext = {
        botId: adapter.createId(config.account_id),
        createId: (value: string | number) => adapter.createId(value),
    };

    if (bot.receiveMode === "webhook") {
        adapter.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));
    }

    bot.on("ready", () => {
        const me = bot.getCachedMe();
        account.nickname = me?.nickname || me?.username || "KOOK Bot";
        account.avatar = me?.avatar || adapter.icon;
        account.status = AccountStatus.Online;
        adapter.logger.info(`KOOK Bot ${config.account_id} 已就绪（${bot.receiveMode}）`);
    });
    bot.on("close", () => {
        account.status = AccountStatus.OffLine;
    });
    bot.on("reconnecting", ({ attempt, delay }: { attempt: number; delay: number }) => {
        adapter.logger.warn(`KOOK Gateway 将在 ${delay}ms 后进行第 ${attempt} 次重连`);
    });
    bot.on("error", error => {
        adapter.logger.error(`KOOK Bot ${config.account_id} 错误:`, error);
    });
    bot.on("event", async (event: KookEvent, signal: KookSignal) => {
        const me = bot.getCachedMe();
        if (event.type !== 255 && me && event.author_id === me.id) return;
        if (event.msg_id && event.type !== 255) {
            bot.rememberMessageScene(
                event.msg_id,
                event.channel_type === "PERSON" ? "direct" : "channel",
                event.channel_type === "PERSON" ? event.author_id : event.target_id,
                event.channel_type === "PERSON" ? event.extra.code : undefined,
            );
        }
        const context = {
            ...baseContext,
            ...(me ? { selfId: adapter.createId(me.id) } : {}),
        };
        for (const projected of projectKookEvents(event, signal, context)) {
            await account.dispatchAwaited(projected);
        }
    });

    account.on("start", async (signal: AbortSignal) => {
        try {
            await bot.start(signal);
        } catch (error) {
            account.status = AccountStatus.OffLine;
            adapter.logger.error("启动 KOOK Bot 失败:", error);
            throw error;
        }
    });
    account.on("stop", async () => {
        await bot.stop();
        account.status = AccountStatus.OffLine;
    });
    return account;
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            kook: KookConfig;
        }
    }
}
