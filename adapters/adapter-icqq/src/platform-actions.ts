import type { Client } from "@icqqjs/icqq";
import type { CommonTypes } from "onebots";
import { compileICQQMessage } from "./messages.js";

export const ICQQ_PLATFORM_ACTIONS = new Set([
    "get_client_key",
    "get_pskey",
    "refresh_nt_pic_rkey",
    "uid_to_uin",
    "uin_to_uid",
    "get_online_status",
    "set_online_status",
    "get_client_statistics",
    "set_nickname",
    "set_gender",
    "set_birthday",
    "set_description",
    "set_signature",
    "get_profile",
    "set_avatar",
    "get_roaming_stamps",
    "delete_stamp",
    "add_friend_group",
    "delete_friend_group",
    "rename_friend_group",
    "reload_friend_list",
    "reload_stranger_list",
    "reload_guild_list",
    "reload_group_list",
    "reload_blacklist",
    "get_stranger_list",
    "image_ocr",
    "get_video_url",
    "get_group_share_json",
    "send_group_sign",
    "set_group_member_screen",
    "add_group_member_as_friend",
    "get_forum_url",
    "send_temp_message",
    "send_discuss_message",
]);

/** 调用 ICQQ 无法由通用 Adapter 语义准确表达的原生能力。 */
export async function executeICQQPlatformAction(
    client: Client,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    switch (action) {
        case "get_client_key":
            return client.getClientKey();
        case "get_pskey":
            return client.getPSkey(stringOrStrings(params.domains, "domains"));
        case "refresh_nt_pic_rkey":
            return client.refreshNTPicRkey(optionalBoolean(params.force));
        case "uid_to_uin":
            return Array.isArray(params.uid)
                ? client.uid2uins(stringArray(params.uid, "uid"), optionalInteger(params.group_id))
                : client.uid2uin(
                      requiredString(params.uid, "uid"),
                      optionalInteger(params.group_id),
                  );
        case "uin_to_uid":
            return Array.isArray(params.uin)
                ? client.uin2uids(integerArray(params.uin, "uin"), optionalInteger(params.group_id))
                : client.uin2uid(
                      requiredInteger(params.uin, "uin"),
                      optionalInteger(params.group_id),
                  );
        case "get_online_status":
            return client.getOnlineStatus();
        case "set_online_status":
            return client.setOnlineStatus(requiredInteger(params.status, "status"));
        case "get_client_statistics":
            return client.stat;
        case "set_nickname":
            return client.setNickname(requiredString(params.nickname, "nickname"));
        case "set_gender":
            return client.setGender(gender(params.gender));
        case "set_birthday":
            return client.setBirthday(stringOrInteger(params.birthday, "birthday"));
        case "set_description":
            return client.setDescription(optionalString(params.description));
        case "set_signature":
            return client.setSignature(optionalString(params.signature));
        case "get_profile":
            return client.getProfile(stringOrInteger(params.user_id, "user_id"));
        case "set_avatar":
            return client.setAvatar(requiredString(params.file, "file"));
        case "get_roaming_stamps":
            return client.getRoamingStamp(optionalBoolean(params.no_cache));
        case "delete_stamp":
            return client.deleteStamp(stringOrStrings(params.id, "id"));
        case "add_friend_group":
            return client.addClass(requiredString(params.name, "name"));
        case "delete_friend_group":
            return client.deleteClass(requiredInteger(params.id, "id"));
        case "rename_friend_group":
            return client.renameClass(
                requiredInteger(params.id, "id"),
                requiredString(params.name, "name"),
            );
        case "reload_friend_list":
            return client.reloadFriendList();
        case "reload_stranger_list":
            return client.reloadStrangerList();
        case "reload_guild_list":
            return client.reloadGuilds();
        case "reload_group_list":
            return client.reloadGroupList();
        case "reload_blacklist":
            return client.reloadBlackList();
        case "get_stranger_list":
            return [...client.getStrangerList().values()];
        case "image_ocr":
            return client.imageOcr(requiredString(params.file, "file"));
        case "get_video_url":
            return client.getVideoUrl(
                requiredString(params.fid, "fid"),
                requiredString(params.md5, "md5"),
            );
        case "get_group_share_json":
            return client.getGroupShareJson(requiredInteger(params.group_id, "group_id"));
        case "send_group_sign":
            return client.sendGroupSign(requiredInteger(params.group_id, "group_id"));
        case "set_group_member_screen":
            return client.setGroupMemberScreenMsg(
                requiredInteger(params.group_id, "group_id"),
                requiredInteger(params.user_id, "user_id"),
                optionalBoolean(params.enabled),
            );
        case "add_group_member_as_friend":
            return client.addFriend(
                requiredInteger(params.group_id, "group_id"),
                requiredInteger(params.user_id, "user_id"),
                optionalString(params.comment),
            );
        case "get_forum_url":
            return client.getForumUrl(
                requiredString(params.guild_id, "guild_id"),
                requiredString(params.channel_id, "channel_id"),
                requiredString(params.forum_id, "forum_id"),
            );
        case "send_temp_message":
            return client.sendTempMsg(
                requiredInteger(params.group_id, "group_id"),
                requiredInteger(params.user_id, "user_id"),
                platformMessage(params.message),
            );
        case "send_discuss_message":
            return client.sendDiscussMsg(
                requiredInteger(params.discuss_id, "discuss_id"),
                platformMessage(params.message),
            );
        default:
            throw new TypeError(`未实现 ICQQ 平台动作: ${action}`);
    }
}

function platformMessage(value: unknown) {
    if (!Array.isArray(value)) throw new TypeError("message 必须是消息段数组");
    return compileICQQMessage(value as CommonTypes.Segment[]);
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) throw new TypeError(`${field} 必须是非空字符串`);
    return value;
}

function optionalString(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new TypeError("参数必须是字符串");
    return value;
}

function requiredInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new TypeError(`${field} 必须是安全整数`);
    }
    return value;
}

function optionalInteger(value: unknown): number | undefined {
    return value === undefined ? undefined : requiredInteger(value, "参数");
}

function optionalBoolean(value: unknown): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") throw new TypeError("参数必须是布尔值");
    return value;
}

function stringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) throw new TypeError(`${field} 必须是字符串数组`);
    return value.map(item => requiredString(item, field));
}

function integerArray(value: unknown, field: string): number[] {
    if (!Array.isArray(value)) throw new TypeError(`${field} 必须是整数数组`);
    return value.map(item => requiredInteger(item, field));
}

function stringOrStrings(value: unknown, field: string): string | string[] {
    return Array.isArray(value) ? stringArray(value, field) : requiredString(value, field);
}

function stringOrInteger(value: unknown, field: string): string | number {
    return typeof value === "string" ? requiredString(value, field) : requiredInteger(value, field);
}

function gender(value: unknown): 0 | 1 | 2 {
    const result = requiredInteger(value, "gender");
    if (result !== 0 && result !== 1 && result !== 2) {
        throw new TypeError("gender 只能是 0、1 或 2");
    }
    return result;
}
