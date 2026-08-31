import {
    definePlatformHttpActionRoutes,
    type PlatformHttpActionParamRule,
    type PlatformHttpActionRoute,
    type PlatformHttpActionValidationIssue,
} from "onebots";
import type { HeychatBot } from "./bot.js";
import { HeychatApiError } from "./errors.js";

export type HeychatActionParamRule = PlatformHttpActionParamRule;
export type HeychatActionRoute = PlatformHttpActionRoute;

/** 将 Heychat 官方 REST 声明编译为严格的平台动作。 */
export function defineHeychatActionRoutes(routes: Readonly<Record<string, HeychatActionRoute>>) {
    return definePlatformHttpActionRoutes<HeychatBot>(
        routes,
        (bot, request) =>
            bot.callApi(
                request.path,
                request.method === "GET"
                    ? { query: { ...request.query } }
                    : {
                          method: "POST",
                          ...(request.query ? { query: { ...request.query } } : {}),
                          body: { ...request.body },
                      },
            ),
        issue => toHeychatValidationError(issue),
    );
}

function toHeychatValidationError(issue: PlatformHttpActionValidationIssue): HeychatApiError {
    if (issue.kind === "unknown") {
        return HeychatApiError.invalid(
            `黑盒语音动作 ${issue.action} 不接受参数 ${issue.parameter}`,
            "HEYCHAT_ACTION_PARAM_UNKNOWN",
            { action: issue.action, parameter: issue.parameter },
        );
    }
    if (issue.kind === "invalid") {
        return HeychatApiError.invalid(
            `黑盒语音动作 ${issue.action} 的参数 ${issue.parameter} 不符合官方契约`,
            "HEYCHAT_ACTION_PARAM_INVALID",
            {
                action: issue.action,
                parameter: issue.parameter,
                value: issue.value,
                rule: issue.rule,
            },
        );
    }
    return HeychatApiError.invalid(
        `黑盒语音动作 ${issue.action} 缺少参数 ${issue.parameters.join("、")}`,
        "HEYCHAT_ACTION_PARAM_REQUIRED",
        {
            action: issue.action,
            parameters: issue.parameters,
            source: issue.source,
            ...(issue.condition ? { condition: issue.condition } : {}),
        },
    );
}
