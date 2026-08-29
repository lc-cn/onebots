import { Account, AccountStatus, ErrorCategory, type RouterContext } from "onebots";
import type { Update } from "grammy/types";
import { TelegramBot } from "./bot.js";
import { projectTelegramEvents } from "./events.js";
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
            const secretHeader = ctx.request.headers["x-telegram-bot-api-secret-token"];
            const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
            if (!bot.verifyWebhookSecret(secret)) {
                ctx.status = 401;
                ctx.body = { ok: false };
                return;
            }
            try {
                await bot.ingest(ctx.request.body);
                ctx.status = 200;
                ctx.body = { ok: true };
            } catch (error) {
                adapter.logger.error(`Telegram webhook ${config.account_id} 处理失败:`, error);
                ctx.status =
                    typeof error === "object" &&
                    error !== null &&
                    "category" in error &&
                    error.category === ErrorCategory.VALIDATION
                        ? 400
                        : 500;
                ctx.body = {
                    ok: false,
                    error:
                        typeof error === "object" && error !== null && "code" in error
                            ? error.code
                            : "TELEGRAM_WEBHOOK_ERROR",
                };
            }
        });
        adapter.logger.info(
            `Telegram Bot ${config.account_id} Webhook 路径: ${account.path}/webhook`,
        );
    }

    bot.on("ready", () => adapter.logger.info(`Telegram Bot ${config.account_id} 已就绪`));
    bot.on("client_error", error =>
        adapter.logger.error(`Telegram Bot ${config.account_id} 错误:`, error),
    );
    bot.on("transport_state", state => {
        account.status = state === "connected" ? AccountStatus.Online : AccountStatus.OffLine;
        adapter.logger.info(`Telegram Bot ${config.account_id} polling 状态: ${state}`);
    });
    bot.on("update", (update: Update) => {
        try {
            const events = projectTelegramEvents(update, {
                botId: adapter.createId(config.account_id),
                createId: value => adapter.createId(value),
            });
            for (const event of events) account.dispatch(event);
        } catch (error) {
            adapter.logger.error(`[Telegram] 投影 Update 失败:`, error);
        }
    });

    account.on("start", async () => {
        try {
            await bot.start();
            if (bot.getReceiveMode() === "webhook") account.status = AccountStatus.Online;
            const me = bot.getCachedMe();
            account.nickname = me?.username || me?.first_name || "Telegram Bot";
            account.avatar = "";
        } catch (error) {
            adapter.logger.error(`启动 Telegram Bot 失败:`, error);
            account.status = AccountStatus.OffLine;
            throw error;
        }
    });
    account.on("stop", async () => {
        await bot.stop();
        account.status = AccountStatus.OffLine;
    });
    return account;
}
