import { definePlatformActions, type PlatformActionHandler } from "onebots";
import type { FeishuBot } from "./bot.js";
import { FeishuError } from "./errors.js";
import { FEISHU_CARDKIT_ACTIONS } from "./platform-actions-cardkit.js";
import {
    bodyValue,
    compactQuery,
    memberIdType,
    optionalBoolean,
    optionalNumber,
    optionalString,
    optionalStringParam,
    queryValue,
    receiveIdType,
    requiredString,
    requireMethod,
    requirePath,
    segment,
    stringArray,
    userIdType,
    without,
} from "./platform-action-input.js";

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
            params: {
                receive_id_type: receiveIdType(params.receive_id_type),
                ...optionalStringParam(params.uuid, "uuid"),
            },
            body: { receive_id: requiredString(params.receive_id, "receive_id") },
        }),
    forward_thread: (bot, params) =>
        bot.callApi(`/im/v1/threads/${segment(params, "thread_id")}/forward`, {
            method: "POST",
            params: {
                receive_id_type: receiveIdType(params.receive_id_type),
                ...optionalStringParam(params.uuid, "uuid"),
            },
            body: { receive_id: requiredString(params.receive_id, "receive_id") },
        }),
    push_follow_up: (bot, params) =>
        bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/push_follow_up`, {
            method: "POST",
            body: without(params, "message_id"),
        }),
    merge_forward_messages: (bot, params) =>
        bot.callApi("/im/v1/messages/merge_forward", {
            method: "POST",
            params: {
                receive_id_type: receiveIdType(params.receive_id_type),
                ...optionalStringParam(params.uuid, "uuid"),
            },
            body: {
                receive_id: requiredString(params.receive_id, "receive_id"),
                message_id_list: stringArray(params.message_id_list, "message_id_list"),
            },
        }),
    get_message_read_users: (bot, params) =>
        bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/read_users`, {
            params: queryValue({
                user_id_type: userIdType(params.user_id_type),
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
    batch_get_reactions: (bot, params) =>
        bot.callApi("/im/v1/messages/reactions/batch_query", {
            method: "POST",
            params: { user_id_type: userIdType(params.user_id_type) },
            body: without(params, "user_id_type"),
        }),
    create_chat: (bot, params) =>
        bot.callApi("/im/v1/chats", {
            method: "POST",
            params: compactQuery({
                user_id_type: userIdType(params.user_id_type),
                set_bot_manager: optionalBoolean(params.set_bot_manager, "set_bot_manager"),
                uuid: optionalString(params.uuid, "uuid"),
            }),
            body: without(params, "user_id_type", "set_bot_manager", "uuid"),
        }),
    update_chat: (bot, params) =>
        bot.callApi(`/im/v1/chats/${segment(params, "chat_id")}`, {
            method: "PUT",
            params: { user_id_type: userIdType(params.user_id_type) },
            body: without(params, "chat_id", "user_id_type"),
        }),
    delete_chat: (bot, params) =>
        bot.callApi(`/im/v1/chats/${segment(params, "chat_id")}`, { method: "DELETE" }),
    add_chat_members: (bot, params) => chatMembers(bot, params, "POST"),
    remove_chat_members: (bot, params) => chatMembers(bot, params, "DELETE"),
    add_chat_managers: (bot, params) => chatManagers(bot, params, "add_managers"),
    delete_chat_managers: (bot, params) => chatManagers(bot, params, "delete_managers"),
    get_chat_link: (bot, params) =>
        bot.callApi(`/im/v1/chats/${segment(params, "chat_id")}/link`, {
            method: "POST",
            body: without(params, "chat_id"),
        }),
    get_chat_announcement: (bot, params) =>
        bot.callApi(`/im/v1/chats/${segment(params, "chat_id")}/announcement`, {
            params: { user_id_type: userIdType(params.user_id_type) },
        }),
    update_chat_announcement: (bot, params) =>
        bot.callApi(`/im/v1/chats/${segment(params, "chat_id")}/announcement`, {
            method: "PATCH",
            body: without(params, "chat_id", "user_id_type"),
        }),
    send_app_urgent: (bot, params) => urgent(bot, params, "urgent_app"),
    send_sms_urgent: (bot, params) => urgent(bot, params, "urgent_sms"),
    send_phone_urgent: (bot, params) => urgent(bot, params, "urgent_phone"),
    create_pin: (bot, params) =>
        bot.callApi("/im/v1/pins", { method: "POST", body: { ...params } }),
    delete_pin: (bot, params) =>
        bot.callApi(`/im/v1/pins/${segment(params, "message_id")}`, { method: "DELETE" }),
    get_pin_list: (bot, params) => bot.callApi("/im/v1/pins", { params: queryValue(params) }),
    get_batch_message_read_stats: (bot, params) =>
        bot.callApi(`/im/v1/batch_messages/${segment(params, "batch_message_id")}/read_user`),
    delete_batch_message: (bot, params) =>
        bot.callApi(`/im/v1/batch_messages/${segment(params, "batch_message_id")}`, {
            method: "DELETE",
        }),
    get_batch_message_progress: (bot, params) =>
        bot.callApi(`/im/v1/batch_messages/${segment(params, "batch_message_id")}/get_progress`),
} satisfies Readonly<Record<string, PlatformActionHandler<FeishuBot>>>;

const PLATFORM_ACTIONS = definePlatformActions(
    { ...ACTION_HANDLERS, ...FEISHU_CARDKIT_ACTIONS },
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
        params: compactQuery({
            member_id_type: memberIdType(params.member_id_type),
            succeed_type:
                method === "POST" ? optionalNumber(params.succeed_type, "succeed_type") : undefined,
        }),
        body: { id_list: stringArray(params.id_list, "id_list") },
    });
}

function chatManagers(
    bot: FeishuBot,
    params: Readonly<Record<string, unknown>>,
    operation: "add_managers" | "delete_managers",
): Promise<unknown> {
    return bot.callApi(`/im/v1/chats/${segment(params, "chat_id")}/managers/${operation}`, {
        method: "POST",
        params: { member_id_type: memberIdType(params.member_id_type) },
        body: { manager_ids: stringArray(params.manager_ids, "manager_ids") },
    });
}

function urgent(
    bot: FeishuBot,
    params: Readonly<Record<string, unknown>>,
    kind: string,
): Promise<unknown> {
    return bot.callApi(`/im/v1/messages/${segment(params, "message_id")}/${kind}`, {
        method: "PATCH",
        params: { user_id_type: userIdType(params.user_id_type) },
        body: { user_id_list: stringArray(params.user_id_list, "user_id_list") },
    });
}
