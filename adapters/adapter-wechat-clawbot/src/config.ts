import { GatewayFault } from "./sdk/internal/errors.js";
import type { WechatClawbotConfig } from "./types.js";

/** 在会话文件、数据库或网络 IO 前闭合微信 ClawBot 配置。 */
export function assertWechatClawbotConfig(config: WechatClawbotConfig): void {
    if (!config.account_id?.trim()) {
        throw new GatewayFault("CONFIG_REQUIRED", "微信 ClawBot account_id 不能为空");
    }
    assertIntegerRange("qr_login_timeout_ms", config.qr_login_timeout_ms, 60_000);
    assertIntegerRange("polling_timeout_ms", config.polling_timeout_ms, 1_000);
    assertIntegerRange(
        "polling_retry_initial_delay_ms",
        config.polling_retry_initial_delay_ms,
        100,
    );
    assertIntegerRange("polling_retry_max_delay_ms", config.polling_retry_max_delay_ms, 1_000);
    const initial = config.polling_retry_initial_delay_ms ?? 1_000;
    const maximum = config.polling_retry_max_delay_ms ?? 30_000;
    if (initial > maximum) {
        throw new GatewayFault(
            "INVALID_CONFIG",
            "polling_retry_initial_delay_ms 不能大于 polling_retry_max_delay_ms",
        );
    }
}

function assertIntegerRange(name: string, value: number | undefined, minimum: number): void {
    if (value !== undefined && (!Number.isInteger(value) || value < minimum)) {
        throw new GatewayFault(
            "INVALID_CONFIG",
            `微信 ClawBot ${name} 必须是大于等于 ${minimum} 的整数`,
        );
    }
}
