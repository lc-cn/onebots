import { DingTalkError } from "./errors.js";
import type { DingTalkConfig } from "./types.js";

/** 在创建 Stream、HTTP 路由或 OpenAPI 请求前闭合钉钉配置。 */
export function assertDingTalkConfig(config: DingTalkConfig): void {
    if (!config.account_id?.trim()) {
        throw DingTalkError.config("钉钉 account_id 不能为空", "DINGTALK_ACCOUNT_ID_REQUIRED");
    }
    if (
        config.receive_mode !== undefined &&
        !["stream", "webhook", "manual"].includes(config.receive_mode)
    ) {
        throw DingTalkError.config(
            "钉钉 receive_mode 必须为 stream、webhook 或 manual",
            "DINGTALK_RECEIVE_MODE_INVALID",
            { receive_mode: config.receive_mode },
        );
    }
    assertPositiveInteger("max_pending_event_handlers", config.max_pending_event_handlers);
    assertPositiveInteger("max_pending_callback_handlers", config.max_pending_callback_handlers);
}

function assertPositiveInteger(name: string, value: number | undefined): void {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 10_000)) {
        throw DingTalkError.config(
            `钉钉 ${name} 必须是 1 到 10000 的整数`,
            "DINGTALK_STREAM_CONCURRENCY_INVALID",
            { field: name, value },
        );
    }
}
