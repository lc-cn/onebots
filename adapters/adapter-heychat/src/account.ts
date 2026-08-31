import { Account, AccountStatus } from "onebots";
import type { HeychatAdapter } from "./adapter.js";
import { HeychatBot } from "./bot.js";
import { projectHeychatEvent } from "./events.js";
import type { HeychatConfig, HeychatWsEnvelope } from "./types.js";

/** 组装黑盒语音账号生命周期，使适配器类只负责动作实现。 */
export function createHeychatAccount(
    adapter: HeychatAdapter,
    config: Account.Config<"heychat">,
): Account<"heychat", HeychatBot> {
    const bot = new HeychatBot(config);
    const account = new Account<"heychat", HeychatBot>(adapter, bot, config);

    bot.on("ready", () => {
        account.status = AccountStatus.Online;
        adapter.logger.info(`黑盒语音 Bot ${config.account_id} 已连接`);
    });
    bot.on("disconnected", details => {
        account.status = AccountStatus.Pending;
        adapter.logger.warn(`黑盒语音 Bot ${config.account_id} 连接中断`, details);
    });
    bot.on("reconnecting", ({ attempt, delay }) => {
        adapter.logger.info(
            `黑盒语音 Bot ${config.account_id} 将在 ${delay}ms 后进行第 ${attempt} 次重连`,
        );
    });
    bot.on("error", error => {
        adapter.logger.error(`黑盒语音 Bot ${config.account_id} 错误:`, error);
    });
    bot.on("stopped", () => {
        account.status = AccountStatus.OffLine;
    });
    bot.on("event", (envelope: HeychatWsEnvelope) => {
        account.dispatch(
            projectHeychatEvent(envelope, {
                accountId: config.account_id,
                botId: bot.getBotId(),
                createId: value => adapter.createId(value),
                getChannelContext: channelId => bot.getChannelContext(channelId),
            }),
        );
    });
    account.on("start", async () => {
        account.status = AccountStatus.Pending;
        await bot.start();
    });
    account.on("stop", async () => bot.stop());
    return account;
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            heychat: HeychatConfig;
        }
    }
}
