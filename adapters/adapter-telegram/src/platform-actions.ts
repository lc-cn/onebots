import type { Bot } from "grammy";
import type { TelegramBot } from "./bot.js";
import { TelegramError } from "./errors.js";

export const TELEGRAM_PLATFORM_ACTIONS = new Set([
    "call_telegram_api",
    "send_poll",
    "forward_message",
    "copy_message",
    "set_message_reaction",
    "pin_message",
    "unpin_message",
    "create_chat_invite_link",
    "set_chat_description",
    "get_chat_administrators",
    "get_chat_member_count",
]);

/** Telegram 专属动作均使用一个参数对象，供所有协议统一转发。 */
export async function executeTelegramPlatformAction(
    bot: TelegramBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const method = telegramMethodName(action, params);
    return bot.callApi(method, () => executeTelegramApi(bot.getBot().api, action, params));
}

const TELEGRAM_ACTION_METHODS: Readonly<Record<string, string>> = {
    send_poll: "sendPoll",
    forward_message: "forwardMessage",
    copy_message: "copyMessage",
    set_message_reaction: "setMessageReaction",
    pin_message: "pinChatMessage",
    unpin_message: "unpinChatMessage",
    create_chat_invite_link: "createChatInviteLink",
    set_chat_description: "setChatDescription",
    get_chat_administrators: "getChatAdministrators",
    get_chat_member_count: "getChatMemberCount",
};

function telegramMethodName(action: string, params: Readonly<Record<string, unknown>>): string {
    return action === "call_telegram_api"
        ? requireMethod(params.method)
        : (TELEGRAM_ACTION_METHODS[action] ?? action);
}

async function executeTelegramApi(
    api: Bot["api"],
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    if (action === "call_telegram_api") {
        const methodName = requireMethod(params.method);
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
    const chatId = requireStringOrNumber(params, "chat_id");
    switch (action) {
        case "send_poll":
            return api.sendPoll(
                chatId,
                requireString(params, "question"),
                requireStringArray(params, "options"),
                params.options_config as never,
            );
        case "forward_message":
            return api.forwardMessage(
                chatId,
                requireStringOrNumber(params, "from_chat_id"),
                requireInteger(params, "message_id"),
                params.options as never,
            );
        case "copy_message":
            return api.copyMessage(
                chatId,
                requireStringOrNumber(params, "from_chat_id"),
                requireInteger(params, "message_id"),
                params.options as never,
            );
        case "set_message_reaction":
            return api.setMessageReaction(
                chatId,
                requireInteger(params, "message_id"),
                requireStringArray(params, "reactions").map(emoji => ({
                    type: "emoji" as const,
                    emoji,
                })) as never,
            );
        case "pin_message":
            return api.pinChatMessage(chatId, requireInteger(params, "message_id"), {
                disable_notification: params.disable_notification === true,
            });
        case "unpin_message":
            return api.unpinChatMessage(
                chatId,
                params.message_id == null ? undefined : requireInteger(params, "message_id"),
            );
        case "create_chat_invite_link":
            return api.createChatInviteLink(chatId, params.options as never);
        case "set_chat_description":
            return api.setChatDescription(chatId, requireString(params, "description"));
        case "get_chat_administrators":
            return api.getChatAdministrators(chatId);
        case "get_chat_member_count":
            return api.getChatMemberCount(chatId);
        default:
            throw TelegramError.invalid(
                `未实现 Telegram 平台动作: ${action}`,
                "TELEGRAM_ACTION_UNSUPPORTED",
            );
    }
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
