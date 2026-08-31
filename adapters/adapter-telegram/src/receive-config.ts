import type { PollingOptions } from "grammy";
import { TELEGRAM_UPDATE_TYPES, type TelegramConfig, type TelegramUpdateType } from "./types.js";
import { TelegramError } from "./errors.js";

export type TelegramReceiveConfig =
    | { mode: "manual" }
    | { mode: "polling"; options: PollingOptions; dropPendingUpdates: boolean }
    | {
          mode: "webhook";
          url: string;
          secretToken: string;
          ipAddress?: string;
          maxConnections?: number;
          dropPendingUpdates: boolean;
          allowedUpdates: ReadonlyArray<TelegramUpdateType>;
      };

/**
 * 将用户配置闭合为唯一接收计划。Account 路由与 Bot 生命周期必须共用此结果，
 * 避免一端按 URL、另一端按开关判断而同时启动两种接收器。
 */
export function resolveTelegramReceiveConfig(config: TelegramConfig): TelegramReceiveConfig {
    if (config.receive_mode === "manual") return { mode: "manual" };

    const allowedUpdates = resolveAllowedUpdates(
        config.receive_mode === "webhook"
            ? config.webhook?.allowed_updates
            : config.polling?.allowed_updates,
    );

    if (config.receive_mode === "webhook") {
        const url = config.webhook?.url;
        if (!url || !isHttpsUrl(url)) {
            throw TelegramError.invalid(
                "Telegram Webhook 模式必须配置有效的 HTTPS webhook.url",
                "TELEGRAM_WEBHOOK_URL_INVALID",
            );
        }
        const secretToken = config.webhook?.secret_token;
        if (!secretToken || !/^[A-Za-z0-9_-]{1,256}$/.test(secretToken)) {
            throw TelegramError.invalid(
                "Telegram Webhook 模式必须配置 secret_token，且仅允许 1-256 位字母、数字、_ 和 -",
                "TELEGRAM_WEBHOOK_SECRET_INVALID",
            );
        }
        const ipAddress = config.webhook?.ip_address;
        if (ipAddress !== undefined && !isIpAddress(ipAddress)) {
            throw TelegramError.invalid(
                "Telegram webhook.ip_address 必须为合法的 IPv4 或 IPv6 地址",
                "TELEGRAM_WEBHOOK_IP_INVALID",
            );
        }
        return {
            mode: "webhook",
            url,
            secretToken,
            ipAddress,
            maxConnections: optionalInteger(
                config.webhook?.max_connections,
                "webhook.max_connections",
                1,
                100,
            ),
            dropPendingUpdates: config.webhook?.drop_pending_updates === true,
            allowedUpdates,
        };
    }

    return {
        mode: "polling",
        options: {
            timeout: optionalInteger(config.polling?.timeout, "polling.timeout", 1, 50),
            limit: optionalInteger(config.polling?.limit, "polling.limit", 1, 100),
            allowed_updates: allowedUpdates,
        },
        dropPendingUpdates: config.polling?.drop_pending_updates === true,
    };
}

function isIpAddress(value: string): boolean {
    if (value.includes(":")) {
        try {
            return new URL(`http://[${value}]`).hostname.length > 2;
        } catch {
            return false;
        }
    }
    const parts = value.split(".");
    return (
        parts.length === 4 &&
        parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
    );
}

function resolveAllowedUpdates(
    values: ReadonlyArray<TelegramUpdateType> | undefined,
): ReadonlyArray<TelegramUpdateType> {
    if (!values?.length) return TELEGRAM_UPDATE_TYPES;
    const allowed = new Set<string>(TELEGRAM_UPDATE_TYPES);
    const unique: TelegramUpdateType[] = [];
    for (const value of values) {
        if (!allowed.has(value)) {
            throw TelegramError.invalid(
                `未知的 Telegram Update 类型：${value}`,
                "TELEGRAM_UPDATE_TYPE_INVALID",
            );
        }
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
        throw TelegramError.invalid(
            `Telegram ${name} 必须是 ${min}-${max} 的整数`,
            "TELEGRAM_POLLING_OPTION_INVALID",
            { name, min, max },
        );
    }
    return value;
}

function isHttpsUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !url.hash;
    } catch {
        return false;
    }
}
