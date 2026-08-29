import type { Bot } from "grammy";
import { definePlatformActions, type PlatformActionHandler } from "onebots";
import type { TelegramBot } from "./bot.js";
import { TelegramError } from "./errors.js";

type TelegramApiHandler = (
    api: Bot["api"],
    params: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

const ACTION_HANDLERS = {
    call_telegram_api: (bot, params) => {
        const methodName = requireMethod(params.method);
        return bot.callApi(methodName, () => callRawApi(bot.getBot().api, methodName, params));
    },
    send_poll: telegramAction("sendPoll", (api, params) =>
        api.sendPoll(
            requireStringOrNumber(params, "chat_id"),
            requireString(params, "question"),
            requireStringArray(params, "options"),
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
            requireStringArray(params, "reactions").map(emoji => ({
                type: "emoji" as const,
                emoji,
            })) as never,
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
    create_chat_invite_link: telegramAction("createChatInviteLink", (api, params) =>
        api.createChatInviteLink(requireStringOrNumber(params, "chat_id"), params.options as never),
    ),
    set_chat_description: telegramAction("setChatDescription", (api, params) =>
        api.setChatDescription(
            requireStringOrNumber(params, "chat_id"),
            requireString(params, "description"),
        ),
    ),
    get_chat_administrators: telegramAction("getChatAdministrators", (api, params) =>
        api.getChatAdministrators(requireStringOrNumber(params, "chat_id")),
    ),
    get_chat_member_count: telegramAction("getChatMemberCount", (api, params) =>
        api.getChatMemberCount(requireStringOrNumber(params, "chat_id")),
    ),
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

function telegramAction(
    method: string,
    handler: TelegramApiHandler,
): PlatformActionHandler<TelegramBot> {
    return (bot, params) => bot.callApi(method, () => handler(bot.getBot().api, params));
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

function optionalObject(
    value: unknown,
    name: string,
): Readonly<Record<string, unknown>> | undefined {
    if (value == null) return undefined;
    if (typeof value !== "object" || Array.isArray(value)) {
        throw TelegramError.invalid(`Telegram 参数 ${name} 必须为对象`, "TELEGRAM_PARAM_INVALID", {
            name,
        });
    }
    return value as Readonly<Record<string, unknown>>;
}

function requireString(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value) {
        throw TelegramError.invalid(
            `Telegram 参数 ${name} 必须为字符串`,
            "TELEGRAM_PARAM_REQUIRED",
            { name },
        );
    }
    return value;
}

function requireStringOrNumber(
    params: Readonly<Record<string, unknown>>,
    name: string,
): string | number {
    const value = params[name];
    if (
        ((typeof value !== "string" || !value) && typeof value !== "number") ||
        (typeof value === "number" && !Number.isSafeInteger(value))
    ) {
        throw TelegramError.invalid(
            `Telegram 参数 ${name} 必须为字符串或数字`,
            "TELEGRAM_PARAM_INVALID",
            { name },
        );
    }
    return value;
}

function requireInteger(params: Readonly<Record<string, unknown>>, name: string): number {
    const source = params[name];
    const value = Number(source);
    if (
        (typeof source !== "string" && typeof source !== "number") ||
        !Number.isSafeInteger(value) ||
        value <= 0
    ) {
        throw TelegramError.invalid(`Telegram 参数 ${name} 必须为整数`, "TELEGRAM_PARAM_INVALID", {
            name,
        });
    }
    return value;
}

function requireStringArray(params: Readonly<Record<string, unknown>>, name: string): string[] {
    const value = params[name];
    if (!Array.isArray(value) || !value.every(item => typeof item === "string")) {
        throw TelegramError.invalid(
            `Telegram 参数 ${name} 必须为字符串数组`,
            "TELEGRAM_PARAM_INVALID",
            { name },
        );
    }
    return value;
}
