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
    "set_gender",
    "set_birthday",
    "set_description",
    "set_signature",
    "get_profile",
    "get_add_friend_setting",
    "get_user_status",
    "set_friend_remark",
    "set_friend_group",
    "search_same_groups",
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
    "get_group_at_all_remainder",
    "get_group_mute_member_list",
    "get_group_anonymous_info",
    "set_group_message_rate_limit",
    "set_group_join_type",
    "set_group_remark",
    "set_group_member_screen",
    "delete_group_message_reaction",
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
                ? client.uid2uins(stringArray(params.uid, "uid"), optionalQQNumber(params.group_id))
                : client.uid2uin(
                      requiredString(params.uid, "uid"),
                      optionalQQNumber(params.group_id),
                  );
        case "uin_to_uid":
            return Array.isArray(params.uin)
                ? client.uin2uids(
                      qqNumberArray(params.uin, "uin"),
                      optionalQQNumber(params.group_id),
                  )
                : client.uin2uid(
                      requiredQQNumber(params.uin, "uin"),
                      optionalQQNumber(params.group_id),
                  );
        case "get_online_status":
            return client.getOnlineStatus();
        case "set_online_status":
            return client.setOnlineStatus(requiredInteger(params.status, "status"));
        case "get_client_statistics":
            return client.stat;
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
        case "get_add_friend_setting":
            return client
                .pickUser(requiredQQNumber(params.user_id, "user_id"))
                .getAddFriendSetting();
        case "get_user_status":
            return client
                .pickUser(requiredQQNumber(params.user_id, "user_id"))
                .getStatusInfo(optionalBoolean(params.use_jce));
        case "set_friend_remark":
            return client
                .pickFriend(requiredQQNumber(params.user_id, "user_id"))
                .setRemark(requiredString(params.remark, "remark"));
        case "set_friend_group":
            return client
                .pickFriend(requiredQQNumber(params.user_id, "user_id"))
                .setClass(requiredInteger(params.group_id, "group_id"));
        case "search_same_groups":
            return client.pickFriend(requiredQQNumber(params.user_id, "user_id")).searchSameGroup();
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
            return client.getGroupShareJson(requiredQQNumber(params.group_id, "group_id"));
        case "send_group_sign":
            return client.sendGroupSign(requiredQQNumber(params.group_id, "group_id"));
        case "get_group_at_all_remainder":
            return client
                .pickGroup(requiredQQNumber(params.group_id, "group_id"))
                .getAtAllRemainder();
        case "get_group_mute_member_list":
            return client
                .pickGroup(requiredQQNumber(params.group_id, "group_id"))
                .getMuteMemberList();
        case "get_group_anonymous_info":
            return client.pickGroup(requiredQQNumber(params.group_id, "group_id")).getAnonyInfo();
        case "set_group_message_rate_limit":
            return setGroupMessageRateLimit(client, params);
        case "set_group_join_type":
            return setGroupJoinType(client, params);
        case "set_group_remark":
            return setGroupRemark(client, params);
        case "set_group_member_screen":
            return client.setGroupMemberScreenMsg(
                requiredQQNumber(params.group_id, "group_id"),
                requiredQQNumber(params.user_id, "user_id"),
                optionalBoolean(params.enabled),
            );
        case "delete_group_message_reaction":
            return deleteGroupMessageReaction(client, params);
        case "add_group_member_as_friend":
            return client.addFriend(
                requiredQQNumber(params.group_id, "group_id"),
                requiredQQNumber(params.user_id, "user_id"),
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
                requiredQQNumber(params.group_id, "group_id"),
                requiredQQNumber(params.user_id, "user_id"),
                platformMessage(params.message),
            );
        case "send_discuss_message":
            return client.sendDiscussMsg(
                requiredQQNumber(params.discuss_id, "discuss_id"),
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

function requiredQQNumber(value: unknown, field: string): number {
    if (typeof value === "string" && /^\d+$/u.test(value)) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed)) return parsed;
    }
    return requiredInteger(value, field);
}

function optionalInteger(value: unknown): number | undefined {
    return value === undefined ? undefined : requiredInteger(value, "参数");
}

function optionalQQNumber(value: unknown): number | undefined {
    return value === undefined ? undefined : requiredQQNumber(value, "group_id");
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

function qqNumberArray(value: unknown, field: string): number[] {
    if (!Array.isArray(value)) throw new TypeError(`${field} 必须是整数数组`);
    return value.map(item => requiredQQNumber(item, field));
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

function groupMessageRate(value: unknown): 0 | 5 | 10 {
    const result = requiredInteger(value, "times");
    if (result !== 0 && result !== 5 && result !== 10) {
        throw new TypeError("times 只能是 0、5 或 10");
    }
    return result;
}

function groupJoinType(value: unknown): "AnyOne" | "None" | "requireAuth" | "QAjoin" | "Correct" {
    if (
        value === "AnyOne" ||
        value === "None" ||
        value === "requireAuth" ||
        value === "QAjoin" ||
        value === "Correct"
    ) {
        return value;
    }
    throw new TypeError("type 必须是 AnyOne、None、requireAuth、QAjoin 或 Correct");
}

function setGroupMessageRateLimit(
    client: Client,
    params: Readonly<Record<string, unknown>>,
): Promise<boolean> {
    const groupId = requiredQQNumber(params.group_id, "group_id");
    const times = groupMessageRate(params.times);
    return client.pickGroup(groupId).setMessageRateLimit(times);
}

function setGroupJoinType(
    client: Client,
    params: Readonly<Record<string, unknown>>,
): Promise<boolean | undefined> {
    const groupId = requiredQQNumber(params.group_id, "group_id");
    const type = groupJoinType(params.type);
    const question = optionalString(params.question);
    const answer = optionalString(params.answer);
    if ((type === "QAjoin" || type === "Correct") && !question) {
        throw new TypeError(`${type} 加群策略必须提供 question`);
    }
    if (type === "Correct" && !answer) {
        throw new TypeError("Correct 加群策略必须提供 answer");
    }
    return client.pickGroup(groupId).setGroupJoinType(type, question, answer);
}

function setGroupRemark(client: Client, params: Readonly<Record<string, unknown>>): Promise<void> {
    const groupId = requiredQQNumber(params.group_id, "group_id");
    const remark = optionalString(params.remark);
    return client.pickGroup(groupId).setRemark(remark);
}

async function deleteGroupMessageReaction(
    client: Client,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const messageId = requiredString(params.message_id, "message_id");
    const message = await client.getMsg(messageId);
    if (!message || message.message_type !== "group") {
        throw new TypeError("删除群消息表态需要有效的群消息 ID");
    }
    if (
        params.group_id !== undefined &&
        message.group_id !== requiredQQNumber(params.group_id, "group_id")
    ) {
        throw new TypeError("消息不属于指定群");
    }
    return client
        .pickGroup(message.group_id)
        .delReaction(
            message.seq,
            String(stringOrInteger(params.face_id, "face_id")),
            optionalInteger(params.face_type),
        );
}
