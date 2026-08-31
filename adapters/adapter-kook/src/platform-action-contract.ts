import type { PlatformActionHandler } from "onebots";
import type { KookBot } from "./bot.js";
import { KookError } from "./errors.js";

export interface KookStringParamRule {
    type: "string";
    required?: boolean;
    values?: readonly string[];
    default?: string;
    minLength?: number;
    maxLength?: number;
}

export interface KookIntegerParamRule {
    type: "integer";
    required?: boolean;
    min?: number;
    max?: number;
    values?: readonly number[];
    default?: number;
}

export type KookActionParamRule = KookStringParamRule | KookIntegerParamRule;

export interface KookActionRouteContract {
    path: string;
    method: "GET" | "POST";
    params: Readonly<Record<string, KookActionParamRule>>;
    /** 每个字段组都必须至少提供一项，用于表达官方 one-of 参数约束。 */
    atLeastOne?: readonly (readonly string[])[];
}

type KookActionValue = string | number;

/**
 * 将 KOOK 官方端点声明编译成平台动作处理器。
 *
 * 命名动作是稳定的公共接口，因此只接受契约内的字段；需要调用尚未收录的端点或字段时，
 * 应显式使用 `call_kook_api`，避免拼写错误和过期字段被悄悄发送到平台。
 */
export function defineKookActionRoutes(
    routes: Readonly<Record<string, KookActionRouteContract>>,
): Readonly<Record<string, PlatformActionHandler<KookBot>>> {
    const handlers: Record<string, PlatformActionHandler<KookBot>> = {};
    for (const [action, route] of Object.entries(routes)) {
        handlers[action] = (bot, params) => {
            const values = validateParams(action, params, route.params);
            validateAtLeastOne(action, values, route.atLeastOne);
            return bot.callApi(
                route.path,
                route.method === "GET" ? { query: values } : { method: "POST", body: values },
            );
        };
    }
    return handlers;
}

function validateAtLeastOne(
    action: string,
    values: Readonly<Record<string, KookActionValue>>,
    groups?: readonly (readonly string[])[],
): void {
    for (const keys of groups || []) {
        if (keys.some(key => Object.hasOwn(values, key))) continue;
        throw KookError.invalid(
            `KOOK 动作 ${action} 必须至少提供参数 ${keys.join(" 或 ")}`,
            "KOOK_ACTION_PARAM_REQUIRED",
            { action, keys },
        );
    }
}

function validateParams(
    action: string,
    params: Readonly<Record<string, unknown>>,
    rules: Readonly<Record<string, KookActionParamRule>>,
): Record<string, KookActionValue> {
    for (const key of Object.keys(params)) {
        if (!Object.hasOwn(rules, key)) {
            throw KookError.invalid(
                `KOOK 动作 ${action} 不接受参数 ${key}`,
                "KOOK_ACTION_PARAM_UNKNOWN",
                { action, key },
            );
        }
    }

    const result: Record<string, KookActionValue> = {};
    for (const [key, rule] of Object.entries(rules)) {
        const value = params[key];
        if (value === undefined) {
            if (rule.default !== undefined) {
                result[key] = validateValue(action, key, rule.default, rule);
                continue;
            }
            if (rule.required) {
                throw KookError.invalid(
                    `KOOK 动作 ${action} 缺少参数 ${key}`,
                    "KOOK_ACTION_PARAM_REQUIRED",
                    { action, key },
                );
            }
            continue;
        }
        result[key] = validateValue(action, key, value, rule);
    }
    return result;
}

function validateValue(
    action: string,
    key: string,
    value: unknown,
    rule: KookActionParamRule,
): KookActionValue {
    if (rule.type === "string") {
        if (
            typeof value !== "string" ||
            value.length === 0 ||
            (rule.minLength !== undefined && value.length < rule.minLength) ||
            (rule.maxLength !== undefined && value.length > rule.maxLength) ||
            !isAllowed(value, rule.values)
        ) {
            throw invalidValue(action, key, value, rule);
        }
        return value;
    }
    if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        (rule.min !== undefined && value < rule.min) ||
        (rule.max !== undefined && value > rule.max) ||
        !isAllowed(value, rule.values)
    ) {
        throw invalidValue(action, key, value, rule);
    }
    return value;
}

function isAllowed<T extends string | number>(value: T, values?: readonly T[]): boolean {
    return values === undefined || values.includes(value);
}

function invalidValue(
    action: string,
    key: string,
    value: unknown,
    rule: KookActionParamRule,
): KookError {
    return KookError.invalid(
        `KOOK 动作 ${action} 的参数 ${key} 不符合官方契约`,
        "KOOK_ACTION_PARAM_INVALID",
        { action, key, value, rule },
    );
}
