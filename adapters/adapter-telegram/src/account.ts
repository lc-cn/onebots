import {
    Account,
    AccountStatus,
    ConnectionManager,
    RetryPresets,
    type RouterContext,
} from "onebots";
import type { Update } from "grammy/types";
import { TelegramBot } from "./bot.js";
import { projectTelegramEvents } from "./events.js";
import type { TelegramConfig } from "./types.js";
import type { TelegramAdapter } from "./adapter.js";
import { ingestTelegramHttp } from "./webhook.js";

export function createTelegramAccount(
    adapter: TelegramAdapter,
    config: Account.Config<"telegram">,
): Account<"telegram", TelegramBot> {
    const telegramConfig: TelegramConfig = {
        account_id: config.account_id,
        token: config.token,
        receive_mode: config.receive_mode ?? "polling",
        webhook: config.webhook,
        polling: config.polling,
        proxy: config.proxy,
    };
    const bot = new TelegramBot(telegramConfig);
    const account = new Account<"telegram", TelegramBot>(adapter, bot, config);

    if (bot.getReceiveMode() === "webhook") {
        adapter.app.router.post(`${account.path}/webhook`, async (ctx: RouterContext) => {
            const secretHeader = ctx.request.headers["x-telegram-bot-api-secret-token"];
            const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
            const result = await ingestTelegramHttp(bot, ctx.request.body, secret);
            ctx.status = result.status;
            ctx.body = result.body;
            if (result.status >= 400) {
                adapter.logger.error(
                    `Telegram webhook ${config.account_id} 处理失败: ${result.body.error}`,
                );
            }
        });
        adapter.logger.info(
            `Telegram Bot ${config.account_id} Webhook 路径: ${account.path}/webhook`,
        );
    }

    const syncIdentity = (): void => {
        const me = bot.getCachedMe();
        account.nickname = me?.username || me?.first_name || "Telegram Bot";
        account.avatar = "";
    };
    bot.on("ready", () => {
        syncIdentity();
        if (bot.getReceiveMode() !== "polling") account.status = AccountStatus.Online;
        adapter.logger.info(`Telegram Bot ${config.account_id} 已就绪`);
    });
    bot.on("client_error", error =>
        adapter.logger.error(`Telegram Bot ${config.account_id} 错误:`, error),
    );
    bot.on("transport_state", state => {
        account.status = state === "connected" ? AccountStatus.Online : AccountStatus.OffLine;
        if (state === "connected") syncIdentity();
        adapter.logger.info(`Telegram Bot ${config.account_id} polling 状态: ${state}`);
    });
    bot.on("update", async (update: Update) => {
        const events = projectTelegramEvents(update, {
            botId: adapter.createId(bot.getCachedMe()?.id || config.account_id),
            createId: value => adapter.createId(value),
        });
        for (const event of events) await account.dispatchAwaited(event);
    });

    const manager = new ConnectionManager(() => bot.start(), RetryPresets.websocket, {
        logger: adapter.logger,
    });
    account.on("start", async () => {
        account.status = AccountStatus.Pending;
        await manager.start();
    });
    account.on("stop", async () => {
        manager.stop();
        await bot.stop();
        account.status = AccountStatus.OffLine;
    });
    return account;
}
