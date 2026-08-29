import { Account, AccountStatus } from "onebots";
import type { DingTalkAdapter } from "./adapter.js";
import { DingTalkBot } from "./bot.js";
import { projectDingTalkEvent, projectDingTalkRobotMessage } from "./events.js";
import type { DingTalkConfig, DingTalkEvent, DingTalkRobotMessage } from "./types.js";

/** 创建钉钉账号，并把所有接收方式汇入同一条事件投影链路。 */
export function createDingTalkAccount(
    adapter: DingTalkAdapter,
    config: Account.Config<"dingtalk">,
): Account<"dingtalk", DingTalkBot> {
    const dingtalkConfig: DingTalkConfig = { ...config };
    const bot = new DingTalkBot(dingtalkConfig);
    const account = new Account<"dingtalk", DingTalkBot>(adapter, bot, config);
    const context = {
        botId: adapter.createId(config.account_id),
        createId: (value: string | number) => adapter.createId(value),
    };

    if (bot.receiveMode === "webhook") {
        adapter.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));
    }

    bot.on("ready", () => {
        adapter.logger.info(`钉钉 Bot ${config.account_id} 已就绪（${bot.receiveMode}）`);
    });
    bot.on("error", error => {
        adapter.logger.error(`钉钉 Bot ${config.account_id} 错误:`, error);
    });
    bot.on("robot_message", (message: DingTalkRobotMessage, raw: unknown) => {
        const me = bot.getCachedMe();
        if (me && (message.senderId === me.userid || message.senderStaffId === me.userid)) return;
        const projected = projectDingTalkRobotMessage(message, rawRecord(raw), context);
        if (projected) account.dispatch(projected);
    });
    const dispatchEvent = (event: DingTalkEvent) => {
        const projected = projectDingTalkEvent(event, context);
        if (projected) account.dispatch(projected);
    };
    bot.on("event", dispatchEvent);
    bot.on("native_event", dispatchEvent);

    account.on("start", async () => {
        try {
            await bot.start();
            const me = bot.getCachedMe();
            account.nickname = me?.name || "钉钉机器人";
            account.avatar = me?.avatar || adapter.icon;
            account.status = AccountStatus.Online;
        } catch (error) {
            adapter.logger.error("启动钉钉 Bot 失败:", error);
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

function rawRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : { value };
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            dingtalk: DingTalkConfig;
        }
    }
}
