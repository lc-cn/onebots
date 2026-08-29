import type { PollingOptions } from "grammy";
import { TELEGRAM_UPDATE_TYPES, type TelegramConfig, type TelegramUpdateType } from "./types.js";

export type TelegramReceiveConfig =
    | { mode: "polling"; options: PollingOptions }
    | {
          mode: "webhook";
          url: string;
          secretToken?: string;
          allowedUpdates: ReadonlyArray<TelegramUpdateType>;
      };

/**
 * 将用户配置闭合为唯一接收计划。Account 路由与 Bot 生命周期必须共用此结果，
 * 避免一端按 URL、另一端按开关判断而同时启动两种接收器。
 */
export function resolveTelegramReceiveConfig(config: TelegramConfig): TelegramReceiveConfig {
    const allowedUpdates = resolveAllowedUpdates(
        config.receive_mode === "webhook"
            ? config.webhook?.allowed_updates
            : config.polling?.allowed_updates,
    );

    if (config.receive_mode === "webhook") {
        const url = config.webhook?.url;
        if (!url || !isHttpsUrl(url)) {
            throw new Error("Telegram Webhook 模式必须配置有效的 HTTPS webhook.url");
        }
        const secretToken = config.webhook?.secret_token;
        if (secretToken && !/^[A-Za-z0-9_-]{1,256}$/.test(secretToken)) {
            throw new Error("Telegram webhook.secret_token 仅允许 1-256 位字母、数字、_ 和 -");
        }
        return { mode: "webhook", url, secretToken, allowedUpdates };
    }

    return {
        mode: "polling",
        options: {
            timeout: optionalInteger(config.polling?.timeout, "polling.timeout", 1, 50),
            limit: optionalInteger(config.polling?.limit, "polling.limit", 1, 100),
            allowed_updates: allowedUpdates,
        },
    };
}

function resolveAllowedUpdates(
    values: ReadonlyArray<TelegramUpdateType> | undefined,
): ReadonlyArray<TelegramUpdateType> {
    if (!values?.length) return TELEGRAM_UPDATE_TYPES;
    const allowed = new Set<string>(TELEGRAM_UPDATE_TYPES);
    const unique: TelegramUpdateType[] = [];
    for (const value of values) {
        if (!allowed.has(value)) throw new Error(`未知的 Telegram Update 类型：${value}`);
        if (!unique.includes(value)) unique.push(value);
    }
    return unique;
}

function optionalInteger(
    value: number | undefined,
    name: string,
    min: number,
    max: number,
): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`Telegram ${name} 必须是 ${min}-${max} 的整数`);
    }
    return value;
}

function isHttpsUrl(value: string): boolean {
    try {
        return new URL(value).protocol === "https:";
    } catch {
        return false;
    }
}
