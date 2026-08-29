import { definePlatformActions, isSafeAbsoluteApiPath, type PlatformActionHandler } from "onebots";
import type { FeishuBot } from "./bot.js";
import { FeishuError, invalidFeishuParam } from "./errors.js";

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const ACTION_HANDLERS = {
    call_feishu_api: (bot, params) =>
        bot.callApi(requirePath(params.path), {
            method: requireMethod(params.method),
            params: queryValue(params.query),
            body: bodyValue(params.body),
        }),
    reply_message: (bot, params) =>
        bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/reply`, {
            method: "POST",
            body: without(params, "message_id"),
        }),
    forward_message: (bot, params) =>
        bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/forward`, {
            method: "POST",
            body: without(params, "message_id"),
        }),
    merge_forward_messages: (bot, params) =>
        bot.callApi("/im/v1/messages/merge_forward", {
            method: "POST",
            params: {
                receive_id_type: stringValue(params.receive_id_type, "open_id"),
                ...(typeof params.uuid === "string" && params.uuid ? { uuid: params.uuid } : {}),
            },
            body: {
                receive_id: requiredString(params.receive_id, "receive_id"),
                message_id_list: stringArray(params.message_id_list, "message_id_list"),
            },
        }),
    get_message_read_users: (bot, params) =>
        bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/read_users`, {
            params: queryValue({
                user_id_type: stringValue(params.user_id_type, "open_id"),
                ...(params.page_size === undefined ? {} : { page_size: params.page_size }),
                ...(params.page_token === undefined ? {} : { page_token: params.page_token }),
            }),
        }),
    add_reaction: (bot, params) =>
        bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/reactions`, {
            method: "POST",
            body: without(params, "message_id"),
        }),
    delete_reaction: (bot, params) =>
        bot.callApi(
            `/im/v1/messages/${segment(params, "message_id")}/reactions/${segment(params, "reaction_id")}`,
            { method: "DELETE" },
        ),
    get_reactions: (bot, params) =>
        bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/reactions`, {
            params: queryValue(without(params, "message_id")),
        }),
    create_chat: (bot, params) =>
        bot.callApi("/im/v1/chats", { method: "POST", body: { ...params } }),
    update_chat: (bot, params) =>
        bot.callApi(`/im/v1/chats/${segment(params, "chat_id")}`, {
            method: "PUT",
            body: without(params, "chat_id"),
        }),
    delete_chat: (bot, params) =>
        bot.callApi(`/im/v1/chats/${segment(params, "chat_id")}`, { method: "DELETE" }),
    add_chat_members: (bot, params) => chatMembers(bot, params, "POST"),
    remove_chat_members: (bot, params) => chatMembers(bot, params, "DELETE"),
    send_app_urgent: (bot, params) => urgent(bot, params, "urgent_app"),
    send_sms_urgent: (bot, params) => urgent(bot, params, "urgent_sms"),
    send_phone_urgent: (bot, params) => urgent(bot, params, "urgent_phone"),
    create_pin: (bot, params) =>
        bot.callApi("/im/v1/pins", { method: "POST", body: { ...params } }),
    delete_pin: (bot, params) =>
        bot.callApi(`/im/v1/pins/${segment(params, "message_id")}`, { method: "DELETE" }),
    get_pin_list: (bot, params) => bot.callApi("/im/v1/pins", { params: queryValue(params) }),
} satisfies Readonly<Record<string, PlatformActionHandler<FeishuBot>>>;

const PLATFORM_ACTIONS = definePlatformActions(
    ACTION_HANDLERS,
    action =>
        new FeishuError(`未实现飞书平台动作: ${action}`, {
            code: "FEISHU_ACTION_NOT_IMPLEMENTED",
            operation: action,
        }),
);

export const FEISHU_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type FeishuPlatformAction =
    typeof FEISHU_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 执行飞书平台扩展动作；参数对象与开放平台 JSON 保持一致。 */
export async function executeFeishuPlatformAction(
    bot: FeishuBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(bot, action, params);
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
    if (typeof value !== "string" || !isSafeAbsoluteApiPath(value)) {
        throw invalidFeishuParam("飞书参数 path 必须为安全绝对路径", value);
    }
    return value;
}

function requiredString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value) {
        throw invalidFeishuParam(`飞书参数 ${name} 必须为非空字符串`, value);
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
