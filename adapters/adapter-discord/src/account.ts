import { Account, AccountStatus, type RouterContext } from "onebots";
import { DiscordBot } from "./bot.js";
import { projectDiscordEvents } from "./events.js";
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
        receive_mode: config.receive_mode ?? "gateway",
        application_id: config.application_id,
        public_key: config.public_key,
        intents: config.intents,
        shard: config.shard,
        presence: config.presence,
        proxy: config.proxy,
    };
    const bot = new DiscordBot(discordConfig);
    const account = new Account<"discord", DiscordBot>(adapter, bot, config);

    if (["interactions", "webhook_events"].includes(bot.getReceiveMode())) {
        const isWebhookEvents = bot.getReceiveMode() === "webhook_events";
        const path = `${account.path}/${isWebhookEvents ? "events" : "interactions"}`;
        adapter.app.router.post(path, async (ctx: RouterContext) => {
            const rawBody: unknown = ctx.request.rawBody;
            if (typeof rawBody !== "string" && !Buffer.isBuffer(rawBody)) {
                ctx.status = 400;
                ctx.body = {
                    error: "DISCORD_SIGNED_BODY_REQUIRED",
                    message: "Discord HTTP 验签必须保留未经修改的 rawBody",
                };
                return;
            }
            const response = await bot.ingestHttp({
                method: ctx.method,
                body: typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"),
                signature: ctx.get("x-signature-ed25519") || undefined,
                timestamp: ctx.get("x-signature-timestamp") || undefined,
            });
            ctx.status = response.status;
            for (const [name, value] of Object.entries(response.headers)) ctx.set(name, value);
            ctx.body = response.body;
            if (response.status >= 500) {
                adapter.logger.error(
                    `Discord ${isWebhookEvents ? "Webhook Event" : "Interaction"} ${config.account_id} 处理失败（HTTP ${response.status}）`,
                );
            }
        });
        adapter.logger.info(
            `Discord Bot ${config.account_id} ${isWebhookEvents ? "Webhook Events" : "Interactions"} 路径: ${path}`,
        );
    }

    bot.on("ready", user => {
        adapter.logger.info(`Discord Bot ${user.tag} 已就绪`);
        account.status = AccountStatus.Online;
        account.nickname = user.username;
        account.avatar = user.displayAvatarURL();
    });
    bot.on("client_error", error => {
        adapter.logger.error(`Discord Bot 错误:`, error);
    });
    bot.on("reconnecting", () => {
        account.status = AccountStatus.OffLine;
    });
    bot.on("resumed", () => {
        account.status = AccountStatus.Online;
    });
    bot.on("close", () => {
        account.status = AccountStatus.OffLine;
    });
    bot.on("dispatch", async (eventName, data, sequence, sessionId) => {
        const events = projectDiscordEvents(
            { name: eventName, data, sequence, session_id: sessionId },
            {
                botId: adapter.createId(bot.getBotUser()?.id || config.account_id),
                createId: value => adapter.createId(value),
            },
        );
        for (const event of events) {
            await account.dispatchAwaited(event);
        }
    });

    account.on("start", async (signal: AbortSignal) => {
        try {
            await bot.start(signal);
        } catch (error) {
            adapter.logger.error(`启动 Discord Bot 失败:`, error);
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
