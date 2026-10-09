import { isDeepStrictEqual } from "node:util";
import { ConfigError } from "./errors.js";
import { parseAccountConfigKey } from "./account-config.js";
import { ProtocolRegistry } from "./registry.js";
import { deepClone, deepMerge } from "./utils.js";

export interface ConfigurationImpact {
    mode: "none" | "hot" | "restart";
    accounts: Array<{
        platform: string;
        accountId: string;
        action: "add" | "reconnect" | "remove";
    }>;
    protocols: Array<{
        platform: string;
        accountId: string;
        name: string;
        version: string;
        action: "add" | "replace" | "remove";
    }>;
    dynamicFields: string[];
    restartReasons: string[];
}

export interface RuntimeConfigurationResult {
    status: "applied" | "rolled_back" | "recovery_required";
    impact: ConfigurationImpact;
}

/** 只允许在任何运行态副作用发生前使用，供 IPC 安全返回“未受理”。 */
export class RuntimeConfigurationRejectedError extends ConfigError {
    constructor(message: string) {
        super(message);
        this.name = "RuntimeConfigurationRejectedError";
    }
}

const DYNAMIC_FIELDS = new Set(["log_level", "timeout"]);
const STANDARD_PROTOCOLS = new Set(["onebot", "milky", "satori", "mcp"]);

/** 比较有效配置；输出仅包含字段路径和实例身份，绝不包含配置值或凭据。 */
export function planRuntimeConfiguration(
    current: Readonly<Record<string, unknown>>,
    next: Readonly<Record<string, unknown>>,
): ConfigurationImpact {
    const impact: ConfigurationImpact = {
        mode: "none",
        accounts: [],
        protocols: [],
        dynamicFields: [],
        restartReasons: [],
    };
    for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
        if (key === "general" || parseAccountConfigKey(key)) continue;
        if (isDeepStrictEqual(current[key], next[key])) continue;
        (DYNAMIC_FIELDS.has(key) ? impact.dynamicFields : impact.restartReasons).push(key);
    }
    for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
        const identity = parseAccountConfigKey(key);
        if (!identity) continue;
        const scope = { platform: identity.platform, accountId: identity.account_id };
        const before = configurationObject(current[key]);
        const after = configurationObject(next[key]);
        if (!before || !after) {
            impact.accounts.push({ ...scope, action: after ? "add" : "remove" });
            continue;
        }
        const platformConfig = (entry: Record<string, unknown>) =>
            Object.fromEntries(Object.entries(entry).filter(([field]) => !isProtocolKey(field)));
        if (!isDeepStrictEqual(platformConfig(before), platformConfig(after))) {
            impact.accounts.push({ ...scope, action: "reconnect" });
            continue;
        }
        for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
            if (!isProtocolKey(field)) continue;
            const [name, version] = field.split(".");
            if (!(field in before) || !(field in after)) {
                impact.protocols.push({
                    ...scope,
                    name,
                    version,
                    action: field in after ? "add" : "remove",
                });
            } else if (
                !isDeepStrictEqual(
                    effectiveProtocolConfig(current, before, field),
                    effectiveProtocolConfig(next, after, field),
                )
            ) {
                impact.protocols.push({ ...scope, name, version, action: "replace" });
            }
        }
    }
    impact.mode = impact.restartReasons.length
        ? "restart"
        : impact.accounts.length ||
            impact.protocols.length ||
            impact.dynamicFields.length ||
            !isDeepStrictEqual(current.general, next.general)
          ? "hot"
          : "none";
    return impact;
}

export function isProtocolKey(key: string): boolean {
    const [name, version, extra] = key.split(".");
    if (!version || extra !== undefined) return false;
    // 尚未安装的标准协议也应进入验证，不能被当成平台配置静默忽略。
    return (
        ProtocolRegistry.has(name, version) ||
        (STANDARD_PROTOCOLS.has(name) && /^v\d+$/u.test(version))
    );
}

export function effectiveProtocolConfig(
    config: Readonly<Record<string, unknown>>,
    account: Record<string, unknown>,
    key: string,
): Record<string, unknown> {
    const general = configurationObject(config.general);
    return (
        configurationObject(
            deepMerge(
                deepClone(configurationObject(general?.[key]) || {}),
                deepClone(configurationObject(account[key]) || {}),
            ),
        ) || {}
    );
}

function configurationObject(value: unknown): Record<string, unknown> | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("配置条目必须是对象");
    return value as Record<string, unknown>;
}
