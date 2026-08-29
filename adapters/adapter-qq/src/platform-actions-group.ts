import type { QQClient } from "./client.js";
import type { QQActionHandler, QQActionParams } from "./platform-action-context.js";
import {
    optionalNumber,
    optionalQuery,
    optionalRecord,
    optionalString,
    readPlatformCall,
    requiredArray,
    requiredRecord,
    requiredString,
    target,
} from "./platform-action-params.js";

/** C2C / 群消息辅助能力与群加入审批策略。 */
export const QQ_GROUP_ACTIONS = {
    qq_call: async (client: QQClient, params: QQActionParams) =>
        client.call(readPlatformCall(params)),
    send_wakeup: async (client: QQClient, params: QQActionParams) =>
        client.sendWakeup(target(params), requiredString(params, "content")),
    send_typing: async (client: QQClient, params: QQActionParams) =>
        client.sendTyping(target(params), optionalNumber(params.duration) ?? 5),
    acknowledge_interaction: async (client: QQClient, params: QQActionParams) =>
        client.acknowledgeInteraction(
            requiredString(params, "interaction_id"),
            optionalNumber(params.code),
            optionalRecord(params.data),
        ),
    approve_group_join_request: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "POST",
            path: `/v2/groups/${requiredString(params, "group_id")}/approval_join_request/${requiredString(params, "member_openid")}`,
            body: {
                op: params.approve === false ? "decline" : "approve",
                join_request_id: requiredString(params, "join_request_id"),
                reject_reason: optionalString(params.reject_reason),
                ...(typeof params.add_to_member_blacklist === "boolean"
                    ? { add_to_member_blacklist: params.add_to_member_blacklist }
                    : {}),
            },
        }),
    get_group_join_requests: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "GET",
            path: `/v2/groups/${requiredString(params, "group_id")}/join_request_list`,
            query: optionalQuery(params.query),
        }),
    get_group_restrict_chat: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "GET",
            path: `/v2/groups/${requiredString(params, "group_id")}/restrict_chat_setting`,
        }),
    set_group_restrict_chat: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "POST",
            path: `/v2/groups/${requiredString(params, "group_id")}/restrict_chat_setting`,
            body: { members: requiredArray(params, "members") },
        }),
    get_group_bot_state: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "GET",
            path: `/v2/groups/${requiredString(params, "group_id")}/bot_state`,
        }),
    get_group_join_approval_strategies: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "GET",
            path: "/v2/groups/join_approval_strategy",
            query: optionalQuery(params.query),
        }),
    create_group_join_approval_strategy: strategyAction("POST"),
    update_group_join_approval_strategy: strategyAction("PATCH", true),
    delete_group_join_approval_strategy: strategyAction("DELETE", true),
    execute_group_join_approval_strategy: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "POST",
            path: `${strategyPath(params)}/execute`,
            body: {},
        }),
    update_group_join_approval_whitelist: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "POST",
            path: `${strategyPath(params)}/whitelist_users`,
            body: requiredRecord(params, "whitelist"),
        }),
} satisfies Readonly<Record<string, QQActionHandler>>;

function strategyAction(method: "POST" | "PATCH" | "DELETE", identified = false): QQActionHandler {
    return async (client, params) => {
        const path = identified ? strategyPath(params) : "/v2/groups/join_approval_strategy";
        return method === "DELETE"
            ? client.call({ method, path })
            : client.call({ method, path, body: requiredRecord(params, "strategy") });
    };
}

function strategyPath(params: QQActionParams): string {
    return `/v2/groups/join_approval_strategy/${requiredString(params, "strategy_id")}`;
}
