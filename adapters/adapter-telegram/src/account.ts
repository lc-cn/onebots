import { Account, AccountStatus, type RouterContext } from "onebots";
import type { Update } from "grammy/types";
import { TelegramBot } from "./bot.js";
import { projectTelegramUpdate } from "./events.js";
import type { TelegramConfig } from "./types.js";
import type { TelegramAdapter } from "./adapter.js";

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
            const secret = ctx.request.headers["x-telegram-bot-api-secret-token"] as
                | string
                | undefined;
            if (!bot.verifyWebhookSecret(secret)) {
                ctx.status = 401;
                ctx.body = { ok: false };
                return;
            }
            try {
                if (!isTelegramUpdate(ctx.request.body)) {
                    ctx.status = 400;
                    ctx.body = { ok: false };
                    return;
                }
                await bot.handleWebhookUpdate(ctx.request.body);
                ctx.status = 200;
                ctx.body = { ok: true };
            } catch (error) {
                adapter.logger.error(`Telegram webhook ${config.account_id} 处理失败:`, error);
                ctx.status = 500;
                ctx.body = { ok: false };
            }
        });
        adapter.logger.info(
            `Telegram Bot ${config.account_id} Webhook 路径: ${account.path}/webhook`,
        );
    }

    bot.on("ready", () => adapter.logger.info(`Telegram Bot ${config.account_id} 已就绪`));
    bot.on("error", error =>
        adapter.logger.error(`Telegram Bot ${config.account_id} 错误:`, error),
    );
    bot.on("update", (update: Update) => {
        try {
            const event = projectTelegramUpdate(update, {
                botId: adapter.createId(config.account_id),
                createId: value => adapter.createId(value),
            });
            if (event) account.dispatch(event);
        } catch (error) {
            adapter.logger.error(`[Telegram] 投影 Update 失败:`, error);
        }
    });

    account.on("start", async () => {
        try {
            await bot.start();
            account.status = AccountStatus.Online;
            const me = bot.getCachedMe();
            account.nickname = me?.username || me?.first_name || "Telegram Bot";
            account.avatar = "";
        } catch (error) {
            adapter.logger.error(`启动 Telegram Bot 失败:`, error);
            account.status = AccountStatus.OffLine;
        }
    });
    account.on("stop", async () => {
        await bot.stop();
        account.status = AccountStatus.OffLine;
    });
    return account;
}

function isTelegramUpdate(value: unknown): value is Update {
    return (
        typeof value === "object" &&
        value !== null &&
        "update_id" in value &&
        typeof value.update_id === "number"
    );
}
