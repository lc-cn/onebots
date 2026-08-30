import { WeComApiError } from "./errors.js";
import type { WeComConfig } from "./types.js";

/** 校验企业微信客户端构造期不变量，避免运行后才暴露半配置状态。 */
export function assertWeComConfig(config: WeComConfig): void {
    for (const [name, value] of [
        ["account_id", config.account_id],
        ["corp_id", config.corp_id],
        ["corp_secret", config.corp_secret],
        ["agent_id", config.agent_id],
    ] as const) {
        if (!value?.trim()) {
            throw new WeComApiError(`企业微信 ${name} 不能为空`, {
                code: "WECOM_CONFIG_REQUIRED",
            });
        }
    }

    const receiveMode = config.receive_mode || "webhook";
    if (receiveMode !== "webhook" && receiveMode !== "manual") {
        throw new WeComApiError("企业微信 receive_mode 仅支持 webhook 或 manual", {
            code: "WECOM_INVALID_RECEIVE_MODE",
        });
    }
    if (receiveMode === "webhook" && (!config.token?.trim() || !config.encoding_aes_key?.trim())) {
        throw new WeComApiError("企业微信 Webhook 模式必须配置 token 和 encoding_aes_key", {
            code: "WECOM_WEBHOOK_CONFIG_REQUIRED",
        });
    }
    if (config.encoding_aes_key && config.encoding_aes_key.length !== 43) {
        throw new WeComApiError("企业微信 encoding_aes_key 必须是 43 位", {
            code: "WECOM_INVALID_ENCODING_AES_KEY",
        });
    }
    if (config.directory_secret !== undefined && !config.directory_secret.trim()) {
        throw new WeComApiError("企业微信 directory_secret 不能为空字符串", {
            code: "WECOM_INVALID_DIRECTORY_SECRET",
        });
    }
    if (
        config.webhook_deduplication_limit !== undefined &&
        (!Number.isInteger(config.webhook_deduplication_limit) ||
            config.webhook_deduplication_limit < 100)
    ) {
        throw new WeComApiError("企业微信 webhook_deduplication_limit 必须是大于等于 100 的整数", {
            code: "WECOM_INVALID_DEDUPLICATION_LIMIT",
        });
    }
}

/** 规范化可信 API 根地址；拒绝凭据、查询参数和片段，防止 token 外泄。 */
export function resolveWeComApiBaseUrl(value: string): string {
    if (!URL.canParse(value)) {
        throw new WeComApiError("api_base_url 必须是有效 HTTPS URL", {
            code: "WECOM_INVALID_API_BASE_URL",
        });
    }
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new WeComApiError("api_base_url 必须是无凭据、查询参数或片段的 HTTPS URL", {
            code: "WECOM_INVALID_API_BASE_URL",
        });
    }
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}
