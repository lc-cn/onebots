import { WechatApiError } from "./errors.js";
import type { WechatConfig, WechatWebhookConfig } from "./types.js";

/** 在网络请求、路由注册或定时器创建前闭合微信公众号配置。 */
export function assertWechatConfig(config: WechatConfig): void {
    for (const [name, value] of [
        ["account_id", config.account_id],
        ["app_id", config.app_id],
        ["app_secret", config.app_secret],
    ] as const) {
        if (!value?.trim()) {
            throw new WechatApiError(`微信公众号 ${name} 不能为空`, {
                code: "WECHAT_CONFIG_REQUIRED",
            });
        }
    }
    const receiveMode = config.receive_mode || "webhook";
    if (receiveMode !== "webhook" && receiveMode !== "manual") {
        throw new WechatApiError("微信公众号 receive_mode 仅支持 webhook 或 manual", {
            code: "WECHAT_INVALID_RECEIVE_MODE",
        });
    }
    if (receiveMode === "webhook" && !config.token?.trim()) {
        throw new WechatApiError("微信公众号 Webhook 模式必须配置 token", {
            code: "WECHAT_WEBHOOK_CONFIG_REQUIRED",
        });
    }
    if (config.encoding_aes_key && config.encoding_aes_key.length !== 43) {
        throw new WechatApiError("微信公众号 encoding_aes_key 必须是 43 位", {
            code: "WECHAT_INVALID_ENCODING_AES_KEY",
        });
    }
    if (
        config.passive_reply_timeout_ms !== undefined &&
        (!Number.isInteger(config.passive_reply_timeout_ms) ||
            config.passive_reply_timeout_ms < 0 ||
            config.passive_reply_timeout_ms > 4_500)
    ) {
        throw new WechatApiError("passive_reply_timeout_ms 必须是 0 到 4500 的整数", {
            code: "WECHAT_INVALID_PASSIVE_REPLY_TIMEOUT",
        });
    }
    if (
        config.webhook_deduplication_limit !== undefined &&
        (!Number.isInteger(config.webhook_deduplication_limit) ||
            config.webhook_deduplication_limit < 100)
    ) {
        throw new WechatApiError("webhook_deduplication_limit 必须是大于等于 100 的整数", {
            code: "WECHAT_INVALID_DEDUPLICATION_LIMIT",
        });
    }
}

/** 将已校验的 webhook 模式配置收窄为 Host 所需类型。 */
export function requireWechatWebhookConfig(config: WechatConfig): WechatWebhookConfig {
    assertWechatConfig(config);
    if ((config.receive_mode || "webhook") !== "webhook" || !config.token) {
        throw new WechatApiError("当前配置不是可注册路由的 Webhook 模式", {
            code: "WECHAT_WEBHOOK_CONFIG_REQUIRED",
        });
    }
    return { ...config, token: config.token, receive_mode: "webhook" };
}
