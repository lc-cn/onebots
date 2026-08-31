import { createHmac } from "node:crypto";
import { DingTalkError } from "./errors.js";
import type { DingTalkConfig } from "./types.js";

/** 构造自定义机器人的发送地址，并把配置错误隔离在网络请求之前。 */
export function buildSignedWebhookUrl(config: DingTalkConfig): string {
    const raw = config.webhook_url;
    if (!raw) {
        throw DingTalkError.config(
            "钉钉自定义机器人 webhook_url 未配置",
            "DINGTALK_WEBHOOK_URL_REQUIRED",
        );
    }
    let url: URL;
    try {
        url = new URL(raw);
    } catch (error) {
        throw DingTalkError.config(
            "钉钉自定义机器人 webhook_url 无效",
            "DINGTALK_WEBHOOK_URL_INVALID",
            { cause: error instanceof Error ? error.message : String(error) },
        );
    }
    if (url.protocol !== "https:" || url.username || url.password) {
        throw DingTalkError.config(
            "钉钉自定义机器人 webhook_url 必须是无凭据的 HTTPS URL",
            "DINGTALK_WEBHOOK_URL_UNSAFE",
        );
    }
    if (!config.webhook_secret) return url.toString();
    const timestamp = Date.now().toString();
    const sign = createHmac("sha256", config.webhook_secret)
        .update(`${timestamp}\n${config.webhook_secret}`)
        .digest("base64");
    url.searchParams.set("timestamp", timestamp);
    url.searchParams.set("sign", sign);
    return url.toString();
}
