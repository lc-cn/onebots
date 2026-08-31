import type { Account } from "./account.js";
import { ValidationError } from "./errors.js";

/** 拒绝无法形成稳定配置键的账号输入，避免扩展构造阶段处理畸形身份。 */
export function assertAccountIdentity(config: unknown): asserts config is Account.Config {
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
        throw new ValidationError("账号配置必须是对象");
    }
    const candidate = config as Record<string, unknown>;
    assertAccountIdentifier("platform", candidate.platform);
    assertAccountIdentifier("account_id", candidate.account_id);
}

export function assertAccountIdentifier(field: string, value: unknown): asserts value is string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new ValidationError(`账号配置字段 ${field} 必须是非空字符串`);
    }
}
