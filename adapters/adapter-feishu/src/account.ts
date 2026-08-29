import { Account, AccountStatus } from "onebots";
import type { Logger } from "@larksuiteoapi/node-sdk";
import type { FeishuAdapter } from "./adapter.js";
import { FeishuBot } from "./bot.js";
import { projectFeishuEvent } from "./events.js";
import type { FeishuConfig, FeishuEvent, FeishuWebhookBody } from "./types.js";

/** 组装飞书账号生命周期；Webhook 与官方长连接共用同一事件投影。 */
export function createFeishuAccount(
    adapter: FeishuAdapter,
    config: Account.Config<"feishu">,
): Account<"feishu", FeishuBot> {
    const feishuConfig: FeishuConfig = {
        account_id: config.account_id,
        app_id: config.app_id,
        app_secret: config.app_secret,
        encrypt_key: config.encrypt_key,
        verification_token: config.verification_token,
        long_connection: config.long_connection ?? false,
        endpoint: config.endpoint,
    };
    const bot = new FeishuBot(feishuConfig);
    const account = new Account<"feishu", FeishuBot>(adapter, bot, config);
    const lark = bot.endpoint.includes("larksuite.com");
    const platformName = lark ? "Lark" : "飞书";
    const icon = lark ? "https://open.larksuite.com/favicon.ico" : adapter.icon;

    if (feishuConfig.long_connection) {
        bot.configureLongConnection(createSdkLogger(adapter));
    } else {
        adapter.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));
    }
    bot.on("ready", () => {
        const me = bot.getCachedMe();
        account.status = AccountStatus.Online;
        account.nickname = me?.name || `${platformName} Bot`;
        account.avatar = me?.avatar_url || icon;
        adapter.logger.info(`${platformName} Bot ${config.account_id} 已就绪`);
    });
    bot.on("error", error => {
        account.status = AccountStatus.OffLine;
        adapter.logger.error(`${platformName} Bot ${config.account_id} 错误:`, error);
    });
    bot.on("event", (event: FeishuEvent, rawEvent: FeishuWebhookBody) => {
        try {
            if (isOwnMessage(event, bot.getCachedMe()?.open_id)) return;
            const projected = projectFeishuEvent(event, rawEvent, {
                botId: adapter.createId(config.account_id),
                createId: value => adapter.createId(value),
            });
            if (projected) account.dispatch(projected);
        } catch (error) {
            adapter.logger.error(`[${platformName}] 投影原始事件失败:`, error);
        }
    });

    account.on("start", async () => {
        try {
            await bot.start();
        } catch (error) {
            account.status = AccountStatus.OffLine;
            adapter.logger.error(`启动 ${platformName} Bot 失败:`, error);
        }
    });
    account.on("stop", async () => {
        await bot.stop();
        account.status = AccountStatus.OffLine;
    });
    return account;
}

function createSdkLogger(adapter: FeishuAdapter): Logger {
    return {
        error: (...messages: unknown[]) => adapter.logger.error(messages[0], ...messages.slice(1)),
        warn: (...messages: unknown[]) => adapter.logger.warn(messages[0], ...messages.slice(1)),
        info: (...messages: unknown[]) => adapter.logger.info(messages[0], ...messages.slice(1)),
        debug: (...messages: unknown[]) => adapter.logger.debug(messages[0], ...messages.slice(1)),
        trace: (...messages: unknown[]) => adapter.logger.trace(messages[0], ...messages.slice(1)),
    };
}

function isOwnMessage(event: FeishuEvent, selfOpenId?: string): boolean {
    if (!selfOpenId || event.header.event_type !== "im.message.receive_v1") return false;
    const payload = event.event as Record<string, unknown>;
    const sender = payload.sender as { sender_id?: { open_id?: string } } | undefined;
    return sender?.sender_id?.open_id === selfOpenId;
}
