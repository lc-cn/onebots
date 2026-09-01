import type { Account } from "./account.js";
import { ValidationError } from "./errors.js";

export interface AccountConfigKey {
    platform: string;
    account_id: string;
}

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
    if (/\s|[\u0000-\u001f\u007f/\\%?#]/u.test(value)) {
        throw new ValidationError(
            `账号配置字段 ${field} 不能包含空白、控制字符或 URL 保留字符 / \\ % ? #`,
        );
    }
    if (value === "." || value === "..") {
        throw new ValidationError(`账号配置字段 ${field} 不能是 . 或 ..`);
    }
}

/** 解析 `{platform}.{account_id}`，账号 ID 可继续包含点号。无点号的宿主字段返回 null。 */
export function parseAccountConfigKey(key: string): AccountConfigKey | null {
    const separator = key.indexOf(".");
    if (separator < 0) return null;
    const platform = key.slice(0, separator);
    const account_id = key.slice(separator + 1);
    assertAccountIdentifier("platform", platform);
    assertAccountIdentifier("account_id", account_id);
    return { platform, account_id };
}
