import { ValidationError } from "./errors.js";
import type { PlatformActionHandler } from "./platform-action-registry.js";

export interface PlatformHttpStringParamRule {
    type: "string";
    required?: boolean;
    allowEmpty?: boolean;
    values?: readonly string[];
    default?: string;
    minLength?: number;
    maxLength?: number;
}

export interface PlatformHttpIntegerParamRule {
    type: "integer";
    required?: boolean;
    values?: readonly number[];
    default?: number;
    min?: number;
    max?: number;
}

export interface PlatformHttpBooleanParamRule {
    type: "boolean";
    required?: boolean;
    default?: boolean;
}

export interface PlatformHttpArrayParamRule {
    type: "string_array" | "integer_array";
    required?: boolean;
    minItems?: number;
    maxItems?: number;
}

export interface PlatformHttpObjectArrayParamRule {
    type: "object_array";
    required?: boolean;
    minItems?: number;
    maxItems?: number;
    properties: Readonly<Record<string, PlatformHttpActionParamRule>>;
}

export type PlatformHttpActionParamRule =
    | PlatformHttpStringParamRule
    | PlatformHttpIntegerParamRule
    | PlatformHttpBooleanParamRule
    | PlatformHttpArrayParamRule
    | PlatformHttpObjectArrayParamRule;

type PlatformHttpQueryParamRule = Exclude<
    PlatformHttpActionParamRule,
    PlatformHttpArrayParamRule | PlatformHttpObjectArrayParamRule
>;

export interface PlatformHttpConditionalRequirement {
    param: string;
    equals: string | number | boolean;
    required: readonly string[];
}

interface PlatformHttpActionRouteBase {
    path: string;
    /** 每个字段组都必须至少提供一项。 */
    atLeastOne?: readonly (readonly string[])[];
    /** 指定枚举分支的附加必填字段。 */
    requiredWhen?: readonly PlatformHttpConditionalRequirement[];
}

export interface PlatformHttpGetActionRoute extends PlatformHttpActionRouteBase {
    method: "GET";
    params: Readonly<Record<string, PlatformHttpQueryParamRule>>;
}

export interface PlatformHttpPostActionRoute extends PlatformHttpActionRouteBase {
    method: "POST";
    params: Readonly<Record<string, PlatformHttpActionParamRule>>;
    /** 少数官方 POST 接口同时要求 query 与 JSON body。 */
    queryParams?: Readonly<Record<string, PlatformHttpQueryParamRule>>;
}

export type PlatformHttpActionRoute = PlatformHttpGetActionRoute | PlatformHttpPostActionRoute;

type PlatformHttpScalar = string | number | boolean;
type PlatformHttpObject = Readonly<Record<string, unknown>>;
type PlatformHttpActionValue = PlatformHttpScalar | string[] | number[] | PlatformHttpObject[];

export type PlatformHttpActionRequest =
    | {
          method: "GET";
          path: string;
          query: Readonly<Record<string, PlatformHttpScalar>>;
      }
    | {
          method: "POST";
          path: string;
          query?: Readonly<Record<string, PlatformHttpScalar>>;
          body: Readonly<Record<string, PlatformHttpActionValue>>;
      };

export type PlatformHttpActionValidationIssue =
    | { kind: "unknown"; action: string; parameter: string }
    | {
          kind: "required";
          action: string;
          parameters: readonly string[];
          source: "field" | "at_least_one" | "condition";
          condition?: PlatformHttpConditionalRequirement;
      }
    | {
          kind: "invalid";
          action: string;
          parameter: string;
          value: unknown;
          rule: PlatformHttpActionParamRule;
      };

export type PlatformHttpActionInvoker<TContext> = (
    context: TContext,
    request: PlatformHttpActionRequest,
) => Promise<unknown>;

/**
 * 将声明式 HTTP 路由编译成闭合的平台动作 handler。
 *
 * 模块统一负责字段白名单、类型、范围、one-of 与条件必填；平台适配器只需声明路由、
 * 注入真实 HTTP 调用并把验证问题映射成平台错误。
 */
export function definePlatformHttpActionRoutes<TContext>(
    routes: Readonly<Record<string, PlatformHttpActionRoute>>,
    invoke: PlatformHttpActionInvoker<TContext>,
    invalid: (issue: PlatformHttpActionValidationIssue) => Error,
): Readonly<Record<string, PlatformActionHandler<TContext>>> {
    assertRouteContracts(routes);
    const handlers: Record<string, PlatformActionHandler<TContext>> = {};
    for (const [action, route] of Object.entries(routes)) {
        handlers[action] = (context, params) => {
            const rules =
                route.method === "POST" && route.queryParams
                    ? mergePostRules(action, route.params, route.queryParams)
                    : route.params;
            const values = validateParams(action, params, rules, invalid);
            validateAtLeastOne(action, values, route.atLeastOne, invalid);
            validateConditionalRequirements(action, values, route.requiredWhen, invalid);
            return invoke(
                context,
                route.method === "GET"
                    ? { method: "GET", path: route.path, query: toQuery(values) }
                    : {
                          method: "POST",
                          path: route.path,
                          ...(route.queryParams
                              ? { query: toQuery(pickValues(values, route.queryParams)) }
                              : {}),
                          body: pickValues(values, route.params),
                      },
            );
        };
    }
    return Object.freeze(handlers);
}

function assertRouteContracts(routes: Readonly<Record<string, PlatformHttpActionRoute>>): void {
    for (const [action, route] of Object.entries(routes)) {
        const parameters = new Set([
            ...Object.keys(route.params),
            ...(route.method === "POST" ? Object.keys(route.queryParams || {}) : []),
        ]);
        if (
            parameters.size !==
            Object.keys(route.params).length +
                (route.method === "POST" ? Object.keys(route.queryParams || {}).length : 0)
        ) {
            throw new ValidationError(`平台 HTTP 动作 ${action} 的 query 与 body 字段不能重名`);
        }
        const references = [
            ...(route.atLeastOne?.flat() || []),
            ...(route.requiredWhen?.flatMap(item => [item.param, ...item.required]) || []),
        ];
        const unknown = references.find(parameter => !parameters.has(parameter));
        if (unknown) {
            throw new ValidationError(`平台 HTTP 动作 ${action} 的契约引用未知字段 ${unknown}`);
        }
        const rules =
            route.method === "POST" && route.queryParams
                ? { ...route.params, ...route.queryParams }
                : route.params;
        for (const [parameter, rule] of Object.entries(rules)) {
            if ("default" in rule && rule.default !== undefined) {
                validateRuleDefinition(action, parameter, rule.default, rule);
            }
        }
    }
}

function validateRuleDefinition(
    action: string,
    parameter: string,
    value: unknown,
    rule: PlatformHttpActionParamRule,
): void {
    if (isValidValue(value, rule)) return;
    throw new ValidationError(`平台 HTTP 动作 ${action} 的参数 ${parameter} 默认值不符合契约`);
}

function validateParams(
    action: string,
    params: Readonly<Record<string, unknown>>,
    rules: Readonly<Record<string, PlatformHttpActionParamRule>>,
    invalid: (issue: PlatformHttpActionValidationIssue) => Error,
): Record<string, PlatformHttpActionValue> {
    for (const parameter of Object.keys(params)) {
        if (!Object.hasOwn(rules, parameter)) {
            throw invalid({ kind: "unknown", action, parameter });
        }
    }
    const result: Record<string, PlatformHttpActionValue> = {};
    for (const [parameter, rule] of Object.entries(rules)) {
        const value = params[parameter];
        if (value === undefined) {
            if ("default" in rule && rule.default !== undefined) {
                result[parameter] = rule.default;
            } else if (rule.required) {
                throw invalid({
                    kind: "required",
                    action,
                    parameters: [parameter],
                    source: "field",
                });
            }
            continue;
        }
        if (!isValidValue(value, rule)) {
            throw invalid({ kind: "invalid", action, parameter, value, rule });
        }
        result[parameter] = value as PlatformHttpActionValue;
    }
    return result;
}

function isValidValue(value: unknown, rule: PlatformHttpActionParamRule): boolean {
    if (rule.type === "string") {
        return (
            typeof value === "string" &&
            (rule.allowEmpty || value.length > 0) &&
            (rule.minLength === undefined || value.length >= rule.minLength) &&
            (rule.maxLength === undefined || value.length <= rule.maxLength) &&
            (rule.values === undefined || rule.values.includes(value))
        );
    }
    if (rule.type === "boolean") return typeof value === "boolean";
    if (rule.type === "integer") {
        return (
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            (rule.min === undefined || value >= rule.min) &&
            (rule.max === undefined || value <= rule.max) &&
            (rule.values === undefined || rule.values.includes(value))
        );
    }
    if (!Array.isArray(value)) return false;
    if (rule.type === "object_array") {
        return (
            value.every(item => isValidObject(item, rule.properties)) &&
            (rule.minItems === undefined || value.length >= rule.minItems) &&
            (rule.maxItems === undefined || value.length <= rule.maxItems)
        );
    }
    const validItems =
        rule.type === "string_array"
            ? value.every(item => typeof item === "string" && item.length > 0)
            : value.every(item => typeof item === "number" && Number.isSafeInteger(item));
    return (
        validItems &&
        (rule.minItems === undefined || value.length >= rule.minItems) &&
        (rule.maxItems === undefined || value.length <= rule.maxItems)
    );
}

function isValidObject(
    value: unknown,
    properties: Readonly<Record<string, PlatformHttpActionParamRule>>,
): value is PlatformHttpObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const object = value as Readonly<Record<string, unknown>>;
    if (Object.keys(object).some(parameter => !Object.hasOwn(properties, parameter))) return false;
    return Object.entries(properties).every(([parameter, rule]) => {
        const item = object[parameter];
        return item === undefined ? !rule.required : isValidValue(item, rule);
    });
}

function mergePostRules(
    action: string,
    body: Readonly<Record<string, PlatformHttpActionParamRule>>,
    query: Readonly<Record<string, PlatformHttpQueryParamRule>>,
): Readonly<Record<string, PlatformHttpActionParamRule>> {
    for (const parameter of Object.keys(query)) {
        if (Object.hasOwn(body, parameter)) {
            throw new ValidationError(`平台 HTTP 动作 ${action} 的 query 与 body 字段不能重名`);
        }
    }
    return { ...body, ...query };
}

function pickValues(
    values: Readonly<Record<string, PlatformHttpActionValue>>,
    rules: Readonly<Record<string, PlatformHttpActionParamRule>>,
): Record<string, PlatformHttpActionValue> {
    const result: Record<string, PlatformHttpActionValue> = {};
    for (const parameter of Object.keys(rules)) {
        if (Object.hasOwn(values, parameter)) result[parameter] = values[parameter];
    }
    return result;
}

function validateAtLeastOne(
    action: string,
    values: Readonly<Record<string, PlatformHttpActionValue>>,
    groups: readonly (readonly string[])[] | undefined,
    invalid: (issue: PlatformHttpActionValidationIssue) => Error,
): void {
    for (const parameters of groups || []) {
        if (parameters.some(parameter => Object.hasOwn(values, parameter))) continue;
        throw invalid({ kind: "required", action, parameters, source: "at_least_one" });
    }
}

function validateConditionalRequirements(
    action: string,
    values: Readonly<Record<string, PlatformHttpActionValue>>,
    requirements: readonly PlatformHttpConditionalRequirement[] | undefined,
    invalid: (issue: PlatformHttpActionValidationIssue) => Error,
): void {
    for (const requirement of requirements || []) {
        if (values[requirement.param] !== requirement.equals) continue;
        const missing = requirement.required.filter(parameter => !Object.hasOwn(values, parameter));
        if (missing.length) {
            throw invalid({
                kind: "required",
                action,
                parameters: missing,
                source: "condition",
                condition: requirement,
            });
        }
    }
}

function toQuery(
    values: Readonly<Record<string, PlatformHttpActionValue>>,
): Record<string, PlatformHttpScalar> {
    const query: Record<string, PlatformHttpScalar> = {};
    for (const [parameter, value] of Object.entries(values)) {
        if (Array.isArray(value)) {
            throw new ValidationError(`GET 平台动作不能发送数组参数 ${parameter}`);
        }
        query[parameter] = value;
    }
    return query;
}
