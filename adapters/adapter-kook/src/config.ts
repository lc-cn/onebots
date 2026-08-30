import { KookError } from "./errors.js";
import type { KookConfig } from "./types.js";

/** SDK 直连与 OneBots 配置加载共用的运行时约束。 */
export function assertKookConfig(config: KookConfig): void {
    if (!config.account_id?.trim()) {
        throw KookError.configuration("KOOK account_id 不能为空", "KOOK_ACCOUNT_ID_REQUIRED");
    }
    if (!config.token?.trim()) {
        throw KookError.configuration("KOOK token 不能为空", "KOOK_TOKEN_REQUIRED");
    }
    const receiveMode = config.receive_mode || "gateway";
    if (!(["gateway", "webhook", "manual"] as const).includes(receiveMode)) {
        throw KookError.configuration(
            "KOOK receive_mode 仅支持 gateway、webhook 或 manual",
            "KOOK_RECEIVE_MODE_INVALID",
            { receive_mode: receiveMode },
        );
    }
    if (receiveMode === "webhook" && !config.verify_token?.trim()) {
        throw KookError.configuration(
            "KOOK Webhook 模式必须配置 verify_token",
            "KOOK_VERIFY_TOKEN_REQUIRED",
        );
    }
    if (
        config.max_retries !== undefined &&
        (!Number.isInteger(config.max_retries) || config.max_retries < 0 || config.max_retries > 10)
    ) {
        throw KookError.configuration(
            "KOOK max_retries 必须是 0 到 10 的整数",
            "KOOK_MAX_RETRIES_INVALID",
            { max_retries: config.max_retries },
        );
    }
    assertKookOAuthConfig(config.oauth);
}

/** Bot 与独立 OAuth 客户端共用的应用凭据约束。 */
export function assertKookOAuthConfig(config: KookConfig["oauth"]): void {
    if (!config || config.enabled === false) return;
    for (const [name, value] of Object.entries({
        client_id: config.client_id,
        client_secret: config.client_secret,
        redirect_uri: config.redirect_uri,
    })) {
        if (!value?.trim()) {
            throw KookError.configuration(
                `KOOK oauth.${name} 不能为空`,
                "KOOK_OAUTH_CONFIG_REQUIRED",
                { field: name },
            );
        }
    }
    assertSecureUrl(config.redirect_uri, "oauth.redirect_uri", true);
    if (config.authorization_url) {
        assertSecureUrl(config.authorization_url, "oauth.authorization_url");
    }
    if (config.token_url) assertSecureUrl(config.token_url, "oauth.token_url");
}

function assertSecureUrl(value: string, field: string, allowQuery = false): void {
    let url: URL;
    try {
        url = new URL(value);
    } catch (error) {
        throw KookError.configuration(`KOOK ${field} 无效`, "KOOK_OAUTH_URL_INVALID", {
            field,
            value,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        (!allowQuery && url.search)
    ) {
        throw KookError.configuration(
            `KOOK ${field} 必须是无凭据${allowQuery ? "" : "、查询参数"}和片段的 HTTPS URL`,
            "KOOK_OAUTH_URL_INVALID",
            { field, value },
        );
    }
}
