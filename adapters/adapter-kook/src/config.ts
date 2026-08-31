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
}
