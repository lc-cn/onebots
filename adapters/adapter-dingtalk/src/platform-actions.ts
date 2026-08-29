import type { DingTalkBot } from "./bot.js";
import type { DingTalkApiRequestOptions } from "./types.js";

export const DINGTALK_PLATFORM_ACTIONS = new Set([
    "call_dingtalk_api",
    "send_robot_private_message",
    "send_robot_group_message",
    "send_work_notification",
    "get_work_notification_result",
    "recall_work_notification",
    "get_department_users",
    "get_sub_departments",
    "create_department",
    "update_department",
    "delete_department",
    "get_role_list",
    "get_role_users",
    "add_user_roles",
    "remove_user_roles",
]);

/** 执行结构化钉钉扩展动作；参数名称与开放平台保持一致。 */
export async function executeDingTalkPlatformAction(
    bot: DingTalkBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    switch (action) {
        case "call_dingtalk_api":
            return bot.callApi(requirePath(params.path), {
                method: methodValue(params.method),
                auth: authValue(params.auth),
                query: queryValue(params.query),
                body: bodyValue(params.body),
            });
        case "send_robot_private_message":
            return bot.callApi("/v1.0/robot/oToMessages/batchSend", {
                method: "POST",
                body: { ...params },
            });
        case "send_robot_group_message":
            return bot.callApi("/v1.0/robot/groupMessages/send", {
                method: "POST",
                body: { ...params },
            });
        case "send_work_notification":
            return legacy(bot, "/topapi/message/corpconversation/asyncsend_v2", params);
        case "get_work_notification_result":
            return legacy(bot, "/topapi/message/corpconversation/getsendresult", params);
        case "recall_work_notification":
            return legacy(bot, "/topapi/message/corpconversation/recall", params);
        case "get_department_users":
            return legacy(bot, "/topapi/v2/user/list", params);
        case "get_sub_departments":
            return legacy(bot, "/topapi/v2/department/listsub", params);
        case "create_department":
            return legacy(bot, "/topapi/v2/department/create", params);
        case "update_department":
            return legacy(bot, "/topapi/v2/department/update", params);
        case "delete_department":
            return legacy(bot, "/topapi/v2/department/delete", params);
        case "get_role_list":
            return legacy(bot, "/topapi/role/list", params);
        case "get_role_users":
            return legacy(bot, "/topapi/role/simplelist", params);
        case "add_user_roles":
            return legacy(bot, "/topapi/role/addrolesforemps", params);
        case "remove_user_roles":
            return legacy(bot, "/topapi/role/removerolesforemps", params);
        default:
            throw new Error(`未实现钉钉平台动作: ${action}`);
    }
}

function legacy(
    bot: DingTalkBot,
    path: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return bot.callApi(path, { method: "POST", body: { ...params }, auth: "legacy" });
}

function requirePath(value: unknown): string {
    if (typeof value !== "string" || !value.startsWith("/") || value.includes("..")) {
        throw new Error("钉钉参数 path 必须为安全绝对路径");
    }
    return value;
}

function methodValue(value: unknown): DingTalkApiRequestOptions["method"] {
    const method = typeof value === "string" ? value.toUpperCase() : "GET";
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) {
        throw new Error("钉钉参数 method 不是受支持的 HTTP 方法");
    }
    return method as DingTalkApiRequestOptions["method"];
}

function authValue(value: unknown): DingTalkApiRequestOptions["auth"] {
    if (value == null) return undefined;
    if (value === "modern" || value === "legacy" || value === "none") return value;
    throw new Error("钉钉参数 auth 必须为 modern、legacy 或 none");
}

function bodyValue(value: unknown): Record<string, unknown> | undefined {
    if (value == null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("钉钉参数 body 必须为对象");
    }
    return value as Record<string, unknown>;
}

function queryValue(value: unknown): Record<string, string | number | boolean> | undefined {
    if (value == null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("钉钉参数 query 必须为对象");
    }
    const query: Record<string, string | number | boolean> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!["string", "number", "boolean"].includes(typeof item)) {
            throw new Error(`钉钉 query 参数 ${key} 必须为标量`);
        }
        query[key] = item as string | number | boolean;
    }
    return query;
}
