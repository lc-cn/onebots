import { Account, AccountStatus } from "onebots";
import type { SlackAdapter } from "./adapter.js";
import { SlackBot } from "./bot.js";
import { projectSlackEvent } from "./events.js";
import type { SlackConfig, SlackEvent, SlackWebhookBody } from "./types.js";

/** 组装 Slack 账号生命周期；HTTP Events 与 Socket Mode 共用同一投影链路。 */
export function createSlackAccount(
    adapter: SlackAdapter,
    config: Account.Config<"slack">,
): Account<"slack", SlackBot> {
    const slackConfig: SlackConfig = {
        account_id: config.account_id,
        token: config.token,
        signing_secret: config.signing_secret,
        app_token: config.app_token,
        receive_mode: config.receive_mode ?? "socket",
    };
    const bot = new SlackBot(slackConfig);
    const account = new Account<"slack", SlackBot>(adapter, bot, config);

    if (slackConfig.receive_mode === "webhook") {
        adapter.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));
    }
    bot.on("ready", () => {
        const me = bot.getCachedMe();
        account.status = AccountStatus.Online;
        account.nickname = me?.name || "Slack Bot";
        account.avatar = me?.profile?.image_512 || me?.profile?.image_192 || adapter.icon;
        adapter.logger.info(`Slack Bot ${config.account_id} 已就绪`);
    });
    bot.on("client_error", error => {
        adapter.logger.error(`Slack Bot ${config.account_id} 错误:`, error);
    });
    bot.on("transport_state", state => {
        account.status = state === "connected" ? AccountStatus.Online : AccountStatus.OffLine;
        adapter.logger.info(`Slack Bot ${config.account_id} Socket Mode 状态: ${state}`);
    });
    bot.on("event", (event: SlackEvent, envelope: SlackWebhookBody) => {
        try {
            if (event.type === "message" && event.ts && typeof event.channel === "string") {
                bot.rememberMessage(event.ts, event.channel, event.thread_ts);
            }
            const me = bot.getCachedMe();
            if (
                (event.type === "message" || event.type === "app_mention") &&
                event.user === me?.id
            ) {
                return;
            }
            const projected = projectSlackEvent(event, envelope, {
                botId: adapter.createId(config.account_id),
                createId: value => adapter.createId(value),
            });
            if (projected) account.dispatch(projected);
        } catch (error) {
            adapter.logger.error("[Slack] 投影原始事件失败:", error);
        }
    });

    account.on("start", async () => {
        try {
            await bot.start();
        } catch (error) {
            account.status = AccountStatus.OffLine;
            adapter.logger.error("启动 Slack Bot 失败:", error);
            throw error;
        }
    });
    account.on("stop", async () => {
        await bot.stop();
        account.status = AccountStatus.OffLine;
    });
    return account;
}
