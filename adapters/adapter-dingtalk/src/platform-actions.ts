import { definePlatformActions, type PlatformActionHandler } from "onebots";
import { requireDingTalkApiPath } from "./api-path.js";
import type { DingTalkBot } from "./bot.js";
import { DingTalkError } from "./errors.js";
import type { DingTalkApiRequestOptions } from "./types.js";

const ACTION_HANDLERS = {
    call_dingtalk_api: (bot, params) =>
        bot.callApi(requireDingTalkApiPath(params.path), {
            method: methodValue(params.method),
            auth: authValue(params.auth),
            query: queryValue(params.query),
            body: bodyValue(params.body),
        }),
    send_robot_private_message: (bot, params) =>
        bot.callApi("/v1.0/robot/oToMessages/batchSend", {
            method: "POST",
            body: { ...params },
        }),
    send_robot_group_message: (bot, params) =>
        bot.callApi("/v1.0/robot/groupMessages/send", {
            method: "POST",
            body: { ...params },
        }),
    recall_robot_private_messages: (bot, params) =>
        bot.callApi("/v1.0/robot/otoMessages/batchRecall", {
            method: "POST",
            body: { ...params },
        }),
    recall_robot_group_messages: (bot, params) =>
        bot.callApi("/v1.0/robot/groupMessages/recall", {
            method: "POST",
            body: { ...params },
        }),
    get_robot_private_message_status: (bot, params) =>
        bot.callApi("/v1.0/robot/oToMessages/readStatus", {
            method: "GET",
            query: queryValue(params),
        }),
    get_robot_group_message_status: (bot, params) =>
        bot.callApi("/v1.0/robot/groupMessages/query", {
            method: "POST",
            body: { ...params },
        }),
    send_work_notification: (bot, params) =>
        legacy(bot, "/topapi/message/corpconversation/asyncsend_v2", params),
    get_work_notification_result: (bot, params) =>
        legacy(bot, "/topapi/message/corpconversation/getsendresult", params),
    recall_work_notification: (bot, params) =>
        legacy(bot, "/topapi/message/corpconversation/recall", params),
    get_department_users: (bot, params) => legacy(bot, "/topapi/v2/user/list", params),
    get_sub_departments: (bot, params) => legacy(bot, "/topapi/v2/department/listsub", params),
    create_department: (bot, params) => legacy(bot, "/topapi/v2/department/create", params),
    update_department: (bot, params) => legacy(bot, "/topapi/v2/department/update", params),
    delete_department: (bot, params) => legacy(bot, "/topapi/v2/department/delete", params),
    get_role_list: (bot, params) => legacy(bot, "/topapi/role/list", params),
    get_role_users: (bot, params) => legacy(bot, "/topapi/role/simplelist", params),
    add_user_roles: (bot, params) => legacy(bot, "/topapi/role/addrolesforemps", params),
    remove_user_roles: (bot, params) => legacy(bot, "/topapi/role/removerolesforemps", params),
} satisfies Readonly<Record<string, PlatformActionHandler<DingTalkBot>>>;

const PLATFORM_ACTIONS = definePlatformActions(ACTION_HANDLERS, action =>
    DingTalkError.invalid(`未实现钉钉平台动作: ${action}`, "DINGTALK_ACTION_UNSUPPORTED", {
        action,
    }),
);

export const DINGTALK_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type DingTalkPlatformAction =
    typeof DINGTALK_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 执行结构化钉钉扩展动作；参数名称与开放平台保持一致。 */
export async function executeDingTalkPlatformAction(
    bot: DingTalkBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(bot, action, params);
}

function legacy(
    bot: DingTalkBot,
    path: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return bot.callApi(path, { method: "POST", body: { ...params }, auth: "legacy" });
}

function methodValue(value: unknown): DingTalkApiRequestOptions["method"] {
    const method = typeof value === "string" ? value.toUpperCase() : "GET";
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) {
        throw DingTalkError.invalid(
            "钉钉参数 method 不是受支持的 HTTP 方法",
            "DINGTALK_ACTION_METHOD_INVALID",
            { method: value },
        );
    }
    return method as DingTalkApiRequestOptions["method"];
}

function authValue(value: unknown): DingTalkApiRequestOptions["auth"] {
    if (value == null) return undefined;
    if (value === "modern" || value === "legacy" || value === "none") return value;
    throw DingTalkError.invalid(
        "钉钉参数 auth 必须为 modern、legacy 或 none",
        "DINGTALK_ACTION_AUTH_INVALID",
        { auth: value },
    );
}

function bodyValue(value: unknown): Record<string, unknown> | undefined {
    if (value == null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw DingTalkError.invalid("钉钉参数 body 必须为对象", "DINGTALK_ACTION_BODY_INVALID");
    }
    return value as Record<string, unknown>;
}

function queryValue(value: unknown): Record<string, string | number | boolean> | undefined {
    if (value == null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw DingTalkError.invalid("钉钉参数 query 必须为对象", "DINGTALK_ACTION_QUERY_INVALID");
    }
    const query: Record<string, string | number | boolean> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!["string", "number", "boolean"].includes(typeof item)) {
            throw DingTalkError.invalid(
                `钉钉 query 参数 ${key} 必须为标量`,
                "DINGTALK_ACTION_QUERY_VALUE_INVALID",
                { key },
            );
        }
        query[key] = item as string | number | boolean;
    }
    return query;
}
