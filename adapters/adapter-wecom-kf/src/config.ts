import { WeComKfError } from "./errors.js";
import type { WeComKfConfig } from "./types.js";

/** 在任何 API、定时器或文件 IO 发生前闭合微信客服配置。 */
export function assertWeComKfConfig(config: WeComKfConfig): void {
    for (const [name, value] of [
        ["account_id", config.account_id],
        ["corp_id", config.corp_id],
        ["corp_secret", config.corp_secret],
    ] as const) {
        if (!value?.trim()) {
            throw new WeComKfError(`微信客服 ${name} 不能为空`, {
                code: "WECOM_KF_CONFIG_REQUIRED",
            });
        }
    }
    const receiveMode = config.receive_mode || "webhook";
    if (receiveMode !== "webhook" && receiveMode !== "manual") {
        throw new WeComKfError("微信客服 receive_mode 仅支持 webhook 或 manual", {
            code: "WECOM_KF_INVALID_RECEIVE_MODE",
        });
    }
    if (receiveMode === "webhook" && (!config.token?.trim() || !config.encoding_aes_key?.trim())) {
        throw new WeComKfError("微信客服 Webhook 模式必须配置 token 和 encoding_aes_key", {
            code: "WECOM_KF_WEBHOOK_CONFIG_REQUIRED",
        });
    }
    if (config.encoding_aes_key && config.encoding_aes_key.length !== 43) {
        throw new WeComKfError("微信客服 encoding_aes_key 必须是 43 位", {
            code: "WECOM_KF_INVALID_ENCODING_AES_KEY",
        });
    }
    if (
        config.message_deduplication_limit !== undefined &&
        (!Number.isInteger(config.message_deduplication_limit) ||
            config.message_deduplication_limit < 100)
    ) {
        throw new WeComKfError("message_deduplication_limit 必须是大于等于 100 的整数", {
            code: "WECOM_KF_INVALID_DEDUPLICATION_LIMIT",
        });
    }
    if (config.enable_sync_poll && !config.open_kfid?.trim()) {
        throw new WeComKfError("启用补偿轮询时必须配置 open_kfid", {
            code: "WECOM_KF_POLL_ACCOUNT_REQUIRED",
        });
    }
}
