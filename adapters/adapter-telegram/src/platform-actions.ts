import type { Bot } from "grammy";
import { definePlatformActions, type PlatformActionHandler } from "onebots";
import type { TelegramBot } from "./bot.js";
import { TelegramError } from "./errors.js";
import { TELEGRAM_BOT_ACTIONS } from "./platform-actions-bot.js";
import { TELEGRAM_CHAT_ACTIONS } from "./platform-actions-chat.js";
import { TELEGRAM_INTERACTION_ACTIONS } from "./platform-actions-interaction.js";
import { TELEGRAM_MODERN_ACTIONS } from "./platform-actions-modern.js";
import {
    optionalObject,
    requireInteger,
    requirePollOptions,
    requireReactions,
    requireString,
    requireStringOrNumber,
    telegramAction,
} from "./platform-action-params.js";

const ACTION_HANDLERS = {
    call_telegram_api: (bot, params) => {
        const methodName = requireMethod(params.method);
        return bot.callApi(methodName, () => callRawApi(bot.getBot().api, methodName, params));
    },
    send_poll: telegramAction("sendPoll", (api, params) =>
        api.sendPoll(
            requireStringOrNumber(params, "chat_id"),
            requireString(params, "question"),
            requirePollOptions(params),
            params.options_config as never,
        ),
    ),
    forward_message: telegramAction("forwardMessage", (api, params) =>
        api.forwardMessage(
            requireStringOrNumber(params, "chat_id"),
            requireStringOrNumber(params, "from_chat_id"),
            requireInteger(params, "message_id"),
            params.options as never,
        ),
    ),
    copy_message: telegramAction("copyMessage", (api, params) =>
        api.copyMessage(
            requireStringOrNumber(params, "chat_id"),
            requireStringOrNumber(params, "from_chat_id"),
            requireInteger(params, "message_id"),
            params.options as never,
        ),
    ),
    set_message_reaction: telegramAction("setMessageReaction", (api, params) =>
        api.setMessageReaction(
            requireStringOrNumber(params, "chat_id"),
            requireInteger(params, "message_id"),
            requireReactions(params),
        ),
    ),
    pin_message: telegramAction("pinChatMessage", (api, params) =>
        api.pinChatMessage(
            requireStringOrNumber(params, "chat_id"),
            requireInteger(params, "message_id"),
            { disable_notification: params.disable_notification === true },
        ),
    ),
    unpin_message: telegramAction("unpinChatMessage", (api, params) =>
        api.unpinChatMessage(
            requireStringOrNumber(params, "chat_id"),
            params.message_id == null ? undefined : requireInteger(params, "message_id"),
        ),
    ),
    ...TELEGRAM_CHAT_ACTIONS,
    ...TELEGRAM_BOT_ACTIONS,
    ...TELEGRAM_INTERACTION_ACTIONS,
    ...TELEGRAM_MODERN_ACTIONS,
} satisfies Readonly<Record<string, PlatformActionHandler<TelegramBot>>>;

const PLATFORM_ACTIONS = definePlatformActions(ACTION_HANDLERS, action =>
    TelegramError.invalid(`未实现 Telegram 平台动作: ${action}`, "TELEGRAM_ACTION_UNSUPPORTED"),
);

export const TELEGRAM_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type TelegramPlatformAction =
    typeof TELEGRAM_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** Telegram 专属动作均使用一个参数对象，供所有协议统一转发。 */
export async function executeTelegramPlatformAction(
    bot: TelegramBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(bot, action, params);
}

function callRawApi(
    api: Bot["api"],
    methodName: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const raw = api.raw as unknown as Readonly<Record<string, unknown>>;
    const method = raw[methodName];
    if (typeof method !== "function") {
        throw TelegramError.invalid(
            `Telegram Bot API 方法不存在: ${methodName}`,
            "TELEGRAM_API_METHOD_NOT_FOUND",
        );
    }
    const payload = optionalObject(params.params, "params");
    return Reflect.apply(method, raw, payload ? [payload] : []);
}

function requireMethod(value: unknown): string {
    if (typeof value !== "string" || !/^[a-z][A-Za-z0-9]*$/.test(value)) {
        throw TelegramError.invalid(
            "Telegram 参数 method 必须为合法的 Bot API camelCase 方法名",
            "TELEGRAM_API_METHOD_INVALID",
        );
    }
    return value;
}
