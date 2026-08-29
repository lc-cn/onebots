import type { FeishuBot } from "./bot.js";
import { FeishuError, invalidFeishuParam } from "./errors.js";

export const FEISHU_PLATFORM_ACTIONS = new Set([
    "call_feishu_api",
    "reply_message",
    "forward_message",
    "add_reaction",
    "delete_reaction",
    "get_reactions",
    "create_chat",
    "update_chat",
    "delete_chat",
    "add_chat_members",
    "remove_chat_members",
    "send_app_urgent",
    "send_sms_urgent",
    "send_phone_urgent",
    "create_pin",
    "delete_pin",
    "get_pin_list",
]);

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/** 执行飞书平台扩展动作；参数对象与开放平台 JSON 保持一致。 */
export async function executeFeishuPlatformAction(
    bot: FeishuBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    switch (action) {
        case "call_feishu_api":
            return bot.callApi(requirePath(params.path), {
                method: requireMethod(params.method),
                params: queryValue(params.query),
                body: bodyValue(params.body),
            });
        case "reply_message":
            return bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/reply`, {
                method: "POST",
                body: without(params, "message_id"),
            });
        case "forward_message":
            return bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/forward`, {
                method: "POST",
                body: without(params, "message_id"),
            });
        case "add_reaction":
            return bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/reactions`, {
                method: "POST",
                body: without(params, "message_id"),
            });
        case "delete_reaction":
            return bot.callApi(
                `/im/v1/messages/${segment(params, "message_id")}/reactions/${segment(params, "reaction_id")}`,
                { method: "DELETE" },
            );
        case "get_reactions":
            return bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/reactions`, {
                params: queryValue(without(params, "message_id")),
            });
        case "create_chat":
            return bot.callApi("/im/v1/chats", { method: "POST", body: { ...params } });
        case "update_chat":
            return bot.callApi(`/im/v1/chats/${segment(params, "chat_id")}`, {
                method: "PUT",
                body: without(params, "chat_id"),
            });
        case "delete_chat":
            return bot.callApi(`/im/v1/chats/${segment(params, "chat_id")}`, { method: "DELETE" });
        case "add_chat_members":
            return chatMembers(bot, params, "POST");
        case "remove_chat_members":
            return chatMembers(bot, params, "DELETE");
        case "send_app_urgent":
            return urgent(bot, params, "urgent_app");
        case "send_sms_urgent":
            return urgent(bot, params, "urgent_sms");
        case "send_phone_urgent":
            return urgent(bot, params, "urgent_phone");
        case "create_pin":
            return bot.callApi("/im/v1/pins", { method: "POST", body: { ...params } });
        case "delete_pin":
            return bot.callApi(`/im/v1/pins/${segment(params, "message_id")}`, {
                method: "DELETE",
            });
        case "get_pin_list":
            return bot.callApi("/im/v1/pins", { params: queryValue(params) });
        default:
            throw new FeishuError(`未实现飞书平台动作: ${action}`, {
                code: "FEISHU_ACTION_NOT_IMPLEMENTED",
                operation: action,
            });
    }
}

function chatMembers(
    bot: FeishuBot,
    params: Readonly<Record<string, unknown>>,
    method: "POST" | "DELETE",
): Promise<unknown> {
    return bot.callApi(`/im/v1/chats/${segment(params, "chat_id")}/members`, {
        method,
        params: { member_id_type: stringValue(params.member_id_type, "open_id") },
        body: { id_list: stringArray(params.id_list, "id_list") },
    });
}

function urgent(
    bot: FeishuBot,
    params: Readonly<Record<string, unknown>>,
    kind: string,
): Promise<unknown> {
    return bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/${kind}`, {
        method: "PATCH",
        params: { user_id_type: stringValue(params.user_id_type, "open_id") },
        body: { user_id_list: stringArray(params.user_id_list, "user_id_list") },
    });
}

function requirePath(value: unknown): string {
    if (typeof value !== "string" || !value.startsWith("/") || value.includes("..")) {
        throw invalidFeishuParam("飞书参数 path 必须为安全绝对路径", value);
    }
    return value;
}

function requireMethod(value: unknown): Method {
    const method = typeof value === "string" ? value.toUpperCase() : "GET";
    if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method)) {
        throw invalidFeishuParam("飞书参数 method 不是受支持的 HTTP 方法", value);
    }
    return method as Method;
}

function segment(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value || !/^[A-Za-z0-9._:-]+$/.test(value)) {
        throw invalidFeishuParam(`飞书参数 ${name} 必须为合法 ID`, value);
    }
    return encodeURIComponent(value);
}

function bodyValue(value: unknown): Record<string, unknown> | undefined {
    if (value == null) return undefined;
    if (typeof value !== "object" || Array.isArray(value))
        throw invalidFeishuParam("飞书参数 body 必须为对象", value);
    return value as Record<string, unknown>;
}

function queryValue(
    value: Readonly<Record<string, unknown>> | unknown,
): Record<string, string | number | boolean> | undefined {
    if (value == null) return undefined;
    if (typeof value !== "object" || Array.isArray(value))
        throw invalidFeishuParam("飞书参数 query 必须为对象", value);
    const query: Record<string, string | number | boolean> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!["string", "number", "boolean"].includes(typeof item)) {
            throw invalidFeishuParam(`飞书 query 参数 ${key} 必须为标量`, item);
        }
        query[key] = item as string | number | boolean;
    }
    return query;
}

function without(
    params: Readonly<Record<string, unknown>>,
    ...keys: string[]
): Record<string, unknown> {
    return Object.fromEntries(Object.entries(params).filter(([key]) => !keys.includes(key)));
}

function stringValue(value: unknown, fallback: string): string {
    return typeof value === "string" && value ? value : fallback;
}

function stringArray(value: unknown, name: string): string[] {
    if (
        !Array.isArray(value) ||
        !value.length ||
        !value.every(item => typeof item === "string" && item)
    ) {
        throw invalidFeishuParam(`飞书参数 ${name} 必须为非空字符串数组`, value);
    }
    return value;
}
