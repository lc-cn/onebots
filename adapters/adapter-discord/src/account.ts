import { Account, AccountStatus } from "onebots";
import { DiscordBot } from "./bot.js";
import { projectDiscordDispatch } from "./events.js";
import type { DiscordConfig } from "./types.js";
import type { DiscordAdapter } from "./adapter.js";

/** 组装 Discord 账号生命周期；Gateway 事件只经统一 Dispatch 投影一次。 */
export function createDiscordAccount(
    adapter: DiscordAdapter,
    config: Account.Config<"discord">,
): Account<"discord", DiscordBot> {
    const discordConfig: DiscordConfig = {
        account_id: config.account_id,
        token: config.token,
        intents: config.intents,
        presence: config.presence,
        proxy: config.proxy,
    };
    const bot = new DiscordBot(discordConfig);
    const account = new Account<"discord", DiscordBot>(adapter, bot, config);

    bot.on("ready", user => {
        adapter.logger.info(`Discord Bot ${user.tag} 已就绪`);
        account.status = AccountStatus.Online;
        account.nickname = user.username;
        account.avatar = user.displayAvatarURL();
    });
    bot.on("error", error => {
        adapter.logger.error(`Discord Bot 错误:`, error);
        account.status = AccountStatus.OffLine;
    });
    bot.on("close", () => {
        account.status = AccountStatus.OffLine;
    });
    bot.on("dispatch", (eventName: string, data: unknown) => {
        try {
            const event = projectDiscordDispatch(
                { name: eventName, data },
                {
                    botId: adapter.createId(config.account_id),
                    createId: value => adapter.createId(value),
                },
            );
            if (event) account.dispatch(event);
        } catch (error) {
            adapter.logger.error(`[Discord] 投影 Gateway Dispatch 失败:`, error);
        }
    });

    account.on("start", async () => {
        try {
            await bot.start();
        } catch (error) {
            adapter.logger.error(`启动 Discord Bot 失败:`, error);
            account.status = AccountStatus.OffLine;
        }
    });
    account.on("stop", async () => {
        await bot.stop();
        account.status = AccountStatus.OffLine;
    });
    return account;
}
