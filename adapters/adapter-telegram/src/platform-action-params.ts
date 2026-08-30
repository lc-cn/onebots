import type { Bot } from "grammy";
import type { PlatformActionHandler } from "onebots";
import type { TelegramBot } from "./bot.js";
import { TelegramError } from "./errors.js";

type TelegramApiHandler = (
    api: Bot["api"],
    params: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

/** 为显式 Telegram 动作提供统一错误包装与参数边界。 */
export function telegramAction(
    method: string,
    handler: TelegramApiHandler,
): PlatformActionHandler<TelegramBot> {
    return (bot, params) => bot.callApi(method, () => handler(bot.getBot().api, params));
}

export function optionalObject(
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

export function requireObject(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Readonly<Record<string, unknown>> {
    const value = optionalObject(params[name], name);
    if (!value) {
        throw TelegramError.invalid(`Telegram 参数 ${name} 必须为对象`, "TELEGRAM_PARAM_REQUIRED", {
            name,
        });
    }
    return value;
}

export function requireString(
    params: Readonly<Record<string, unknown>>,
    name: string,
    allowEmpty = false,
): string {
    const value = params[name];
    if (typeof value !== "string" || (!allowEmpty && !value)) {
        throw TelegramError.invalid(
            `Telegram 参数 ${name} 必须为字符串`,
            "TELEGRAM_PARAM_REQUIRED",
            { name },
        );
    }
    return value;
}

export function requireStringOrNumber(
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

export function requireInteger(params: Readonly<Record<string, unknown>>, name: string): number {
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

export function requireStringArray(
    params: Readonly<Record<string, unknown>>,
    name: string,
    minimum = 0,
    maximum = Number.MAX_SAFE_INTEGER,
): string[] {
    const value = params[name];
    if (
        !Array.isArray(value) ||
        value.length < minimum ||
        value.length > maximum ||
        !value.every(item => typeof item === "string" && item.length > 0)
    ) {
        throw TelegramError.invalid(
            `Telegram 参数 ${name} 必须为 ${minimum} 到 ${maximum} 项的非空字符串数组`,
            "TELEGRAM_PARAM_INVALID",
            { name },
        );
    }
    return value;
}

export function requireObjectArray(
    params: Readonly<Record<string, unknown>>,
    name: string,
    minimum = 0,
    maximum = Number.MAX_SAFE_INTEGER,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
    const value = params[name];
    if (
        !Array.isArray(value) ||
        value.length < minimum ||
        value.length > maximum ||
        value.some(item => !item || typeof item !== "object" || Array.isArray(item))
    ) {
        throw TelegramError.invalid(
            `Telegram 参数 ${name} 必须为 ${minimum} 到 ${maximum} 项的对象数组`,
            "TELEGRAM_PARAM_INVALID",
            { name },
        );
    }
    return structuredClone(value) as ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export function requireBoolean(params: Readonly<Record<string, unknown>>, name: string): boolean {
    const value = params[name];
    if (typeof value !== "boolean") {
        throw TelegramError.invalid(
            `Telegram 参数 ${name} 必须为布尔值`,
            "TELEGRAM_PARAM_INVALID",
            { name },
        );
    }
    return value;
}

export function requireReactions(params: Readonly<Record<string, unknown>>): never {
    const value = params.reactions;
    if (!Array.isArray(value)) {
        throw TelegramError.invalid(
            "Telegram 参数 reactions 必须为 ReactionType 数组",
            "TELEGRAM_PARAM_INVALID",
            { name: "reactions" },
        );
    }
    const reactions = value.map(item => {
        if (typeof item === "string" && item) return { type: "emoji", emoji: item };
        if (
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            (item as Record<string, unknown>).type
        ) {
            return structuredClone(item);
        }
        throw TelegramError.invalid(
            "Telegram reactions 只接受 emoji 字符串或官方 ReactionType 对象",
            "TELEGRAM_PARAM_INVALID",
            { name: "reactions" },
        );
    });
    return reactions as never;
}
