import { type Adapter, requireBooleanParam, requirePositiveIntegerParam } from "onebots";
import { projectMilkyFriend } from "./friend-entities.js";
import { projectMilkyGroup, projectMilkyGroupMember } from "./group-entities.js";
import { projectMilkyImplInfo, projectMilkyUserProfile } from "./system-entities.js";

export const MILKY_DIRECTORY_ACTIONS = new Set([
    "get_login_info",
    "get_impl_info",
    "get_status",
    "get_user_profile",
    "get_friend_info",
    "get_friend_list",
    "get_group_info",
    "get_group_list",
    "get_group_member_info",
    "get_group_member_list",
    "get_cookies",
    "get_csrf_token",
    "send_friend_nudge",
    "send_profile_like",
]);

/** 封装 Milky 系统信息、联系人目录与资料实体投影。 */
export async function executeMilkyDirectoryAction(
    adapter: Adapter,
    accountId: string,
    action: string,
    params: Record<string, unknown>,
): Promise<unknown> {
    switch (action) {
        case "get_login_info": {
            const info = await adapter.getLoginInfo(accountId);
            return { uin: info.user_id.number, nickname: info.user_name };
        }
        case "get_impl_info":
            return projectMilkyImplInfo(await adapter.getVersion(accountId));
        case "get_status":
            return adapter.getStatus(accountId);
        case "get_user_profile":
            return getUserProfile(adapter, accountId, params);
        case "get_friend_info":
            return getFriendInfo(adapter, accountId, params);
        case "get_friend_list":
            return getFriendList(adapter, accountId, params);
        case "get_group_info":
            return getGroupInfo(adapter, accountId, params);
        case "get_group_list":
            return getGroupList(adapter, accountId, params);
        case "get_group_member_info":
            return getGroupMemberInfo(adapter, accountId, params);
        case "get_group_member_list":
            return getGroupMemberList(adapter, accountId, params);
        case "get_cookies":
            return getCookies(adapter, accountId, params);
        case "get_csrf_token":
            return { csrf_token: await adapter.getCsrfToken(accountId) };
        case "send_friend_nudge":
            await sendFriendNudge(adapter, accountId, params);
            return {};
        case "send_profile_like":
            await sendProfileLike(adapter, accountId, params);
            return {};
        default:
            throw new TypeError(`未知 Milky 目录动作: ${action}`);
    }
}

async function getUserProfile(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    const info = await adapter.getUserInfo(accountId, {
        user_id: adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
        no_cache: optionalBoolean(params, "no_cache", false),
    });
    return projectMilkyUserProfile(info);
}

async function getFriendInfo(adapter: Adapter, accountId: string, params: Record<string, unknown>) {
    const info = await adapter.getFriendInfo(accountId, {
        user_id: adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
        no_cache: optionalBoolean(params, "no_cache", false),
    });
    return { friend: projectMilkyFriend(info) };
}

async function getFriendList(adapter: Adapter, accountId: string, params: Record<string, unknown>) {
    const list = await adapter.getFriendList(accountId, {
        no_cache: optionalBoolean(params, "no_cache", false),
    });
    return { friends: list.map(projectMilkyFriend) };
}

async function getGroupInfo(adapter: Adapter, accountId: string, params: Record<string, unknown>) {
    const info = await adapter.getGroupInfo(accountId, {
        group_id: adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
        no_cache: optionalBoolean(params, "no_cache", false),
    });
    return { group: projectMilkyGroup(info) };
}

async function getGroupList(adapter: Adapter, accountId: string, params: Record<string, unknown>) {
    const list = await adapter.getGroupList(accountId, {
        no_cache: optionalBoolean(params, "no_cache", false),
    });
    return { groups: list.map(projectMilkyGroup) };
}

async function getGroupMemberInfo(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    const info = await adapter.getGroupMemberInfo(accountId, {
        group_id: adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
        user_id: adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
        no_cache: optionalBoolean(params, "no_cache", false),
    });
    return { member: projectMilkyGroupMember(info) };
}

async function getGroupMemberList(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    const list = await adapter.getGroupMemberList(accountId, {
        group_id: adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
        no_cache: optionalBoolean(params, "no_cache", false),
    });
    return { members: list.map(projectMilkyGroupMember) };
}

async function getCookies(adapter: Adapter, accountId: string, params: Record<string, unknown>) {
    const domain =
        typeof params.domain === "string" && params.domain.trim() !== ""
            ? params.domain
            : undefined;
    return { cookies: await adapter.getCookies(accountId, { domain }) };
}

async function sendFriendNudge(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    await adapter.sendFriendNudge(accountId, {
        user_id: adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
        is_self: params.is_self === undefined ? false : requireBooleanParam(params, "is_self"),
    });
}

async function sendProfileLike(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    await adapter.sendLike(accountId, {
        user_id: adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
        count: params.count === undefined ? 1 : requirePositiveIntegerParam(params, "count"),
    });
}

function optionalBoolean(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
    return params[key] === undefined ? fallback : requireBooleanParam(params, key);
}
