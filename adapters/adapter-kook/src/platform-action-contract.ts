import type { PlatformActionHandler } from "onebots";
import type { KookBot } from "./bot.js";
import { KookError } from "./errors.js";

export interface KookStringParamRule {
    type: "string";
    required?: boolean;
    allowEmpty?: boolean;
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

export interface KookBooleanParamRule {
    type: "boolean";
    required?: boolean;
    default?: boolean;
}

export interface KookStringArrayParamRule {
    type: "string_array";
    required?: boolean;
    minItems?: number;
    maxItems?: number;
}

export type KookActionParamRule =
    | KookStringParamRule
    | KookIntegerParamRule
    | KookBooleanParamRule
    | KookStringArrayParamRule;

type KookQueryParamRule = Exclude<KookActionParamRule, KookStringArrayParamRule>;

interface KookActionRouteContractBase {
    path: string;
    /** 每个字段组都必须至少提供一项，用于表达官方 one-of 参数约束。 */
    atLeastOne?: readonly (readonly string[])[];
    /** 当某个枚举字段取指定值时，补充该分支的必填字段。 */
    requiredWhen?: readonly KookConditionalRequirement[];
}

export interface KookConditionalRequirement {
    param: string;
    equals: string | number | boolean;
    required: readonly string[];
}

export interface KookGetActionRouteContract extends KookActionRouteContractBase {
    method: "GET";
    params: Readonly<Record<string, KookQueryParamRule>>;
}

export interface KookPostActionRouteContract extends KookActionRouteContractBase {
    method: "POST";
    params: Readonly<Record<string, KookActionParamRule>>;
}

export type KookActionRouteContract = KookGetActionRouteContract | KookPostActionRouteContract;

type KookActionValue = string | number | boolean | string[];

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
            validateConditionalRequirements(action, values, route.requiredWhen);
            return bot.callApi(
                route.path,
                route.method === "GET"
                    ? { query: toQueryParams(action, values) }
                    : { method: "POST", body: values },
            );
        };
    }
    return handlers;
}

function validateConditionalRequirements(
    action: string,
    values: Readonly<Record<string, KookActionValue>>,
    requirements?: readonly KookConditionalRequirement[],
): void {
    for (const requirement of requirements || []) {
        if (values[requirement.param] !== requirement.equals) continue;
        const missing = requirement.required.filter(key => !Object.hasOwn(values, key));
        if (missing.length === 0) continue;
        throw KookError.invalid(
            `KOOK 动作 ${action} 在 ${requirement.param}=${String(requirement.equals)} 时缺少参数 ${missing.join("、")}`,
            "KOOK_ACTION_PARAM_REQUIRED",
            { action, condition: requirement, missing },
        );
    }
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
            if ("default" in rule && rule.default !== undefined) {
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
            (!rule.allowEmpty && value.length === 0) ||
            (rule.minLength !== undefined && value.length < rule.minLength) ||
            (rule.maxLength !== undefined && value.length > rule.maxLength) ||
            !isAllowed(value, rule.values)
        ) {
            throw invalidValue(action, key, value, rule);
        }
        return value;
    }
    if (rule.type === "boolean") {
        if (typeof value !== "boolean") throw invalidValue(action, key, value, rule);
        return value;
    }
    if (rule.type === "string_array") {
        if (
            !Array.isArray(value) ||
            value.some(item => typeof item !== "string" || !item) ||
            (rule.minItems !== undefined && value.length < rule.minItems) ||
            (rule.maxItems !== undefined && value.length > rule.maxItems)
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

function toQueryParams(
    action: string,
    values: Readonly<Record<string, KookActionValue>>,
): Record<string, string | number | boolean> {
    const query: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(values)) {
        if (Array.isArray(value)) {
            throw KookError.configuration(
                `KOOK 动作 ${action} 的 GET 契约不能声明数组参数 ${key}`,
                "KOOK_ACTION_CONTRACT_INVALID",
                { action, key },
            );
        }
        query[key] = value;
    }
    return query;
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
