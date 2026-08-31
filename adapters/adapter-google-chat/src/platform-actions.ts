import { definePlatformActions, type PlatformActionHandler } from "onebots";
import {
    optionalInteger,
    optionalObject,
    optionalString,
    parseQuery,
    requireMethod,
    requireString,
} from "./action-params.js";
import type { GoogleChatClient } from "./client.js";
import { GoogleChatError } from "./errors.js";

const handlers = {
    call_google_chat_api: (client, params) =>
        client.call(requireMethod(params.method), requireApiPath(params.path), {
            query: parseQuery(params.query),
            body: params.body,
        }),
    find_google_chat_direct_message: (client, params) =>
        client.call("GET", "/v1/spaces:findDirectMessage", {
            query: { name: requireUserName(params.user_name) },
        }),
    find_google_chat_group_chats: (client, params) =>
        client.call("GET", "/v1/spaces:findGroupChats", {
            query: {
                users: requireHumanUserNames(params.user_names),
                pageSize: optionalInteger(params.page_size, "page_size"),
                pageToken: optionalString(params.page_token, "page_token"),
                spaceView: optionalEnum(params.space_view, "space_view", [
                    "SPACE_VIEW_RESOURCE_NAME_ONLY",
                    "SPACE_VIEW_EXPANDED",
                ]),
            },
        }),
    setup_google_chat_space: (client, params) =>
        client.call("POST", "/v1/spaces:setup", {
            body: {
                space: parseSpaceInput(params.space),
                memberships: parseMembershipInputs(params.memberships),
                requestId: optionalString(params.request_id, "request_id"),
            },
        }),
    create_google_chat_space: (client, params) =>
        client.call("POST", "/v1/spaces", {
            query: { requestId: optionalString(params.request_id, "request_id") },
            body: parseSpaceInput(params.space),
        }),
    delete_google_chat_space: (client, params) =>
        client.call("DELETE", `/v1/${requireSpaceName(params.space_name)}`),
    list_google_chat_space_events: (client, params) =>
        client.call("GET", `/v1/${requireSpaceName(params.space_name)}/spaceEvents`, {
            query: {
                filter: optionalString(params.filter, "filter"),
                pageSize: optionalInteger(params.page_size, "page_size"),
                pageToken: optionalString(params.page_token, "page_token"),
            },
        }),
    get_google_chat_availability: (client, params) =>
        client.call("GET", `/v1/${requireUserName(params.user_name)}/availability`),
    mark_google_chat_active: (client, params) =>
        client.call("POST", `/v1/${requireUserName(params.user_name)}/availability:markAsActive`, {
            body: {},
        }),
    mark_google_chat_away: (client, params) =>
        client.call("POST", `/v1/${requireUserName(params.user_name)}/availability:markAsAway`, {
            body: {},
        }),
    mark_google_chat_do_not_disturb: (client, params) =>
        client.call(
            "POST",
            `/v1/${requireUserName(params.user_name)}/availability:markAsDoNotDisturb`,
            { body: parseAvailabilityExpiration(params) },
        ),
    get_google_chat_space_read_state: (client, params) =>
        client.call("GET", `/v1/${requireSpaceReadStateName(params.name)}`),
    get_google_chat_thread_read_state: (client, params) =>
        client.call("GET", `/v1/${requireThreadReadStateName(params.name)}`),
    list_google_chat_reactions: (client, params) =>
        client.call("GET", `/v1/${requireMessageName(params.message_name)}/reactions`, {
            query: {
                filter: optionalString(params.filter, "filter"),
                pageSize: optionalInteger(params.page_size, "page_size"),
                pageToken: optionalString(params.page_token, "page_token"),
            },
        }),
    send_google_chat_rich_message: (client, params) =>
        client.call("POST", `/v1/${requireSpaceName(params.space_name)}/messages`, {
            query: {
                messageId: optionalString(params.message_id, "message_id"),
                messageReplyOption: optionalString(
                    params.message_reply_option,
                    "message_reply_option",
                ),
            },
            body: optionalObject(params.message, "message"),
        }),
} satisfies Readonly<Record<string, PlatformActionHandler<GoogleChatClient>>>;

const actions = definePlatformActions(
    handlers,
    action =>
        new GoogleChatError(`未实现 Google Chat 平台动作: ${action}`, {
            code: "GOOGLE_CHAT_ACTION_NOT_IMPLEMENTED",
        }),
);

export const GOOGLE_CHAT_PLATFORM_ACTIONS = actions.actions;
export type GoogleChatPlatformAction =
    typeof GOOGLE_CHAT_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

export function executeGoogleChatPlatformAction(
    client: GoogleChatClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return actions.execute(client, action, params);
}

function requireApiPath(value: unknown): string {
    const path = requireString(value, "path");
    if (!path.startsWith("/v1/") && path !== "/v1/spaces") {
        throw GoogleChatError.invalid("path 必须位于 Google Chat REST v1 下");
    }
    if (path.includes("?") || path.includes("#") || path.startsWith("//")) {
        throw GoogleChatError.invalid("path 不得包含查询参数、片段或 authority");
    }
    return path;
}

function requireSpaceName(value: unknown): string {
    const name = requireString(value, "space_name");
    if (!/^spaces\/[^/]+$/u.test(name)) throw GoogleChatError.invalid("space_name 无效");
    return name;
}

function requireMessageName(value: unknown): string {
    const name = requireString(value, "message_name");
    if (!/^spaces\/[^/]+\/messages\/[^/]+$/u.test(name)) {
        throw GoogleChatError.invalid("message_name 无效");
    }
    return name;
}

function requireUserName(value: unknown): string {
    const name = requireString(value, "user_name");
    if (!/^users\/(?:app|[^/]+)$/u.test(name)) throw GoogleChatError.invalid("user_name 无效");
    return name;
}

function parseSpaceInput(value: unknown): Record<string, unknown> {
    const space = optionalObject(value, "space");
    const spaceType = requireString(space.spaceType, "space.spaceType");
    if (!["SPACE", "GROUP_CHAT", "DIRECT_MESSAGE"].includes(spaceType)) {
        throw GoogleChatError.invalid("space.spaceType 无效");
    }
    return space;
}

function parseMembershipInputs(value: unknown): Record<string, unknown>[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw GoogleChatError.invalid("memberships 必须是数组");
    return value.map((item, index) => {
        const membership = optionalObject(item, `memberships[${index}]`);
        if (membership.member !== undefined) {
            const member = optionalObject(membership.member, `memberships[${index}].member`);
            requireUserName(member.name);
        } else if (membership.groupMember !== undefined) {
            const group = optionalObject(
                membership.groupMember,
                `memberships[${index}].groupMember`,
            );
            const name = requireString(group.name, `memberships[${index}].groupMember.name`);
            if (!/^groups\/[^/]+$/u.test(name)) {
                throw GoogleChatError.invalid(`memberships[${index}].groupMember.name 无效`);
            }
        } else {
            throw GoogleChatError.invalid(`memberships[${index}] 必须包含 member 或 groupMember`);
        }
        return membership;
    });
}

function requireHumanUserNames(value: unknown): readonly string[] {
    if (!Array.isArray(value) || value.length > 49) {
        throw GoogleChatError.invalid("user_names 必须是最多 49 项的数组");
    }
    return value.map((item, index) => {
        const name = requireString(item, `user_names[${index}]`);
        if (!/^users\/(?!app$|me$)[^/]+$/u.test(name)) {
            throw GoogleChatError.invalid(`user_names[${index}] 必须是 human user resource`);
        }
        return name;
    });
}

function optionalEnum(
    value: unknown,
    field: string,
    choices: readonly string[],
): string | undefined {
    if (value === undefined) return undefined;
    const parsed = requireString(value, field);
    if (!choices.includes(parsed)) throw GoogleChatError.invalid(`${field} 无效`);
    return parsed;
}

function parseAvailabilityExpiration(
    params: Readonly<Record<string, unknown>>,
): Record<string, string> {
    const expireTime = optionalString(params.expire_time, "expire_time");
    const ttl = optionalString(params.ttl, "ttl");
    if ((expireTime ? 1 : 0) + (ttl ? 1 : 0) !== 1) {
        throw GoogleChatError.invalid("expire_time 与 ttl 必须且只能提供一个");
    }
    if (expireTime && !Number.isFinite(Date.parse(expireTime))) {
        throw GoogleChatError.invalid("expire_time 必须是 RFC 3339 时间");
    }
    if (ttl && !/^\d+(?:\.\d{1,9})?s$/u.test(ttl)) {
        throw GoogleChatError.invalid("ttl 必须是 protobuf Duration，例如 3600s");
    }
    return expireTime ? { expireTime } : { ttl: ttl || "" };
}

function requireSpaceReadStateName(value: unknown): string {
    const name = requireString(value, "name");
    if (!/^users\/[^/]+\/spaces\/[^/]+\/spaceReadState$/u.test(name)) {
        throw GoogleChatError.invalid("name 不是有效 spaceReadState resource");
    }
    return name;
}

function requireThreadReadStateName(value: unknown): string {
    const name = requireString(value, "name");
    if (!/^users\/[^/]+\/spaces\/[^/]+\/threads\/[^/]+\/threadReadState$/u.test(name)) {
        throw GoogleChatError.invalid("name 不是有效 threadReadState resource");
    }
    return name;
}
