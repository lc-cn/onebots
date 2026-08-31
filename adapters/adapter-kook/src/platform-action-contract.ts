import {
    definePlatformHttpActionRoutes,
    type PlatformHttpActionParamRule,
    type PlatformHttpActionRoute,
    type PlatformHttpActionValidationIssue,
    type PlatformHttpBooleanParamRule,
    type PlatformHttpConditionalRequirement,
    type PlatformHttpGetActionRoute,
    type PlatformHttpIntegerParamRule,
    type PlatformHttpPostActionRoute,
    type PlatformHttpStringParamRule,
} from "onebots";
import type { KookBot } from "./bot.js";
import { KookError } from "./errors.js";

export type KookStringParamRule = PlatformHttpStringParamRule;
export type KookIntegerParamRule = PlatformHttpIntegerParamRule;
export type KookBooleanParamRule = PlatformHttpBooleanParamRule;
export type KookStringArrayParamRule = Extract<
    PlatformHttpActionParamRule,
    { type: "string_array" }
>;
export type KookActionParamRule = Exclude<PlatformHttpActionParamRule, { type: "integer_array" }>;
export type KookConditionalRequirement = PlatformHttpConditionalRequirement;
export type KookGetActionRouteContract = PlatformHttpGetActionRoute;
export type KookPostActionRouteContract = PlatformHttpPostActionRoute;
export type KookActionRouteContract = PlatformHttpActionRoute;

/**
 * 将 KOOK 官方端点声明编译成闭合的平台动作处理器。
 *
 * 参数契约由 core 统一验证；本层只保留 KOOK REST 调用和结构化错误语义。
 */
export function defineKookActionRoutes(routes: Readonly<Record<string, KookActionRouteContract>>) {
    return definePlatformHttpActionRoutes<KookBot>(
        routes,
        (bot, request) =>
            bot.callApi(
                request.path,
                request.method === "GET"
                    ? { query: { ...request.query } }
                    : { method: "POST", body: { ...request.body } },
            ),
        issue => toKookValidationError(issue),
    );
}

function toKookValidationError(issue: PlatformHttpActionValidationIssue): KookError {
    if (issue.kind === "unknown") {
        return KookError.invalid(
            `KOOK 动作 ${issue.action} 不接受参数 ${issue.parameter}`,
            "KOOK_ACTION_PARAM_UNKNOWN",
            { action: issue.action, key: issue.parameter },
        );
    }
    if (issue.kind === "invalid") {
        return KookError.invalid(
            `KOOK 动作 ${issue.action} 的参数 ${issue.parameter} 不符合官方契约`,
            "KOOK_ACTION_PARAM_INVALID",
            {
                action: issue.action,
                key: issue.parameter,
                value: issue.value,
                rule: issue.rule,
            },
        );
    }
    if (issue.source === "at_least_one") {
        return KookError.invalid(
            `KOOK 动作 ${issue.action} 必须至少提供参数 ${issue.parameters.join(" 或 ")}`,
            "KOOK_ACTION_PARAM_REQUIRED",
            { action: issue.action, keys: issue.parameters },
        );
    }
    if (issue.source === "condition" && issue.condition) {
        return KookError.invalid(
            `KOOK 动作 ${issue.action} 在 ${issue.condition.param}=${String(issue.condition.equals)} 时缺少参数 ${issue.parameters.join("、")}`,
            "KOOK_ACTION_PARAM_REQUIRED",
            { action: issue.action, condition: issue.condition, missing: issue.parameters },
        );
    }
    const [key] = issue.parameters;
    return KookError.invalid(
        `KOOK 动作 ${issue.action} 缺少参数 ${key}`,
        "KOOK_ACTION_PARAM_REQUIRED",
        { action: issue.action, key },
    );
}
