import { ErrorCategory } from "onebots";
import { HeychatApiError } from "./errors.js";
import type { HeychatConfig } from "./types.js";

export type HeychatReceiveMode = "websocket" | "manual";

/** 在创建 HTTP/WS 传输前闭合用户配置。 */
export function assertHeychatConfig(config: HeychatConfig): void {
    if (!config.account_id?.trim()) throw configError("account_id 不能为空", "account_id");
    if (!config.token?.trim()) throw configError("token 不能为空", "token");
    if (
        config.receive_mode !== undefined &&
        !["websocket", "manual"].includes(config.receive_mode)
    ) {
        throw configError("receive_mode 必须是 websocket 或 manual", config.receive_mode);
    }
    if (config.voice_api_type !== undefined && !["trtc", "volc"].includes(config.voice_api_type)) {
        throw configError("voice_api_type 必须是 trtc 或 volc", config.voice_api_type);
    }
    assertInteger("heartbeat_interval_ms", config.heartbeat_interval_ms, 5_000);
    assertInteger("reconnect_initial_delay_ms", config.reconnect_initial_delay_ms, 100);
    assertInteger("reconnect_max_delay_ms", config.reconnect_max_delay_ms, 100);
    assertInteger("request_timeout_ms", config.request_timeout_ms, 1_000);
    const initial = config.reconnect_initial_delay_ms ?? 1_000;
    const maximum = config.reconnect_max_delay_ms ?? 30_000;
    if (initial > maximum) {
        throw configError("reconnect_initial_delay_ms 不能大于 reconnect_max_delay_ms", {
            initial,
            maximum,
        });
    }
}

export function resolveHeychatReceiveMode(
    config: Pick<HeychatConfig, "receive_mode">,
): HeychatReceiveMode {
    return config.receive_mode ?? "websocket";
}

function assertInteger(name: string, value: number | undefined, minimum: number): void {
    if (value !== undefined && (!Number.isInteger(value) || value < minimum)) {
        throw configError(`${name} 必须是大于等于 ${minimum} 的整数`, value);
    }
}

function configError(message: string, details: unknown): HeychatApiError {
    return new HeychatApiError(`黑盒语音配置错误：${message}`, {
        code: "HEYCHAT_INVALID_CONFIG",
        category: ErrorCategory.CONFIG,
        details,
    });
}
