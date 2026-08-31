import type { Client } from "@icqqjs/icqq";
import type { GfsDirStat, GfsFileStat } from "@icqqjs/icqq/lib/gfs";
import {
    definePlatformActionContract,
    type CommonTypes,
    type PlatformActionHandler,
} from "onebots";
import { compileICQQMessage } from "./messages.js";
import {
    ICQQError,
    icqqResourceNotFound,
    invalidICQQParam,
    unexpectedICQQActionParameter,
} from "./errors.js";
import {
    optionalBoolean,
    optionalInteger,
    optionalQQNumber,
    optionalString,
    qqNumberArray,
    record,
    requiredInteger,
    requiredQQNumber,
    requiredString,
    stringArray,
    stringOrInteger,
    stringOrStrings,
    type ICQQPlatformActionParams,
} from "./platform-action-input.js";
import {
    downloadGroupFile,
    getGroupFileEntries,
    makeForwardMessage,
    sendGroupAnonymousMessage,
} from "./platform-native-actions.js";

type Params = ICQQPlatformActionParams;
type Handler = PlatformActionHandler<Client>;

const PLATFORM_ACTION_HANDLERS = {
    get_client_key: async (client: Client) => client.getClientKey(),
    get_pskey: async (client: Client, params: Params) =>
        client.getPSkey(stringOrStrings(params.domains, "domains")),
    refresh_nt_pic_rkey: async (client: Client, params: Params) =>
        client.refreshNTPicRkey(optionalBoolean(params.force)),
    uid_to_uin: uidToUin,
    uin_to_uid: uinToUid,
    get_online_status: async (client: Client) => client.getOnlineStatus(),
    set_online_status: async (client: Client, params: Params) =>
        client.setOnlineStatus(requiredInteger(params.status, "status")),
    get_client_statistics: async (client: Client) => client.stat,
    get_blacklist: async (client: Client) => [...client.blacklist],
    get_friend_groups: async (client: Client) =>
        [...client.classes].map(([group_id, group_name]) => ({ group_id, group_name })),
    set_gender: async (client: Client, params: Params) => client.setGender(gender(params.gender)),
    set_birthday: async (client: Client, params: Params) =>
        client.setBirthday(stringOrInteger(params.birthday, "birthday")),
    set_description: async (client: Client, params: Params) =>
        client.setDescription(optionalString(params.description)),
    set_signature: async (client: Client, params: Params) =>
        client.setSignature(optionalString(params.signature)),
    get_profile: async (client: Client, params: Params) =>
        client.getProfile(stringOrInteger(params.user_id, "user_id")),
    get_add_friend_setting: async (client: Client, params: Params) =>
        client.pickUser(requiredQQNumber(params.user_id, "user_id")).getAddFriendSetting(),
    get_user_status: async (client: Client, params: Params) =>
        client
            .pickUser(requiredQQNumber(params.user_id, "user_id"))
            .getStatusInfo(optionalBoolean(params.use_jce)),
    get_user_avatar_url: async (client: Client, params: Params) =>
        client
            .pickUser(requiredQQNumber(params.user_id, "user_id"))
            .getAvatarUrl(avatarSize(params.size)),
    set_friend_remark: async (client: Client, params: Params) =>
        client
            .pickFriend(requiredQQNumber(params.user_id, "user_id"))
            .setRemark(requiredString(params.remark, "remark")),
    set_friend_group: async (client: Client, params: Params) =>
        client
            .pickFriend(requiredQQNumber(params.user_id, "user_id"))
            .setClass(requiredInteger(params.group_id, "group_id")),
    search_same_groups: async (client: Client, params: Params) =>
        client.pickFriend(requiredQQNumber(params.user_id, "user_id")).searchSameGroup(),
    get_roaming_stamps: async (client: Client, params: Params) =>
        client.getRoamingStamp(optionalBoolean(params.no_cache)),
    delete_stamp: async (client: Client, params: Params) =>
        client.deleteStamp(stringOrStrings(params.id, "id")),
    add_friend_group: async (client: Client, params: Params) =>
        client.addClass(requiredString(params.name, "name")),
    delete_friend_group: async (client: Client, params: Params) =>
        client.deleteClass(requiredInteger(params.id, "id")),
    rename_friend_group: async (client: Client, params: Params) =>
        client.renameClass(requiredInteger(params.id, "id"), requiredString(params.name, "name")),
    reload_friend_list: reloadAction(client => client.reloadFriendList()),
    reload_stranger_list: reloadAction(client => client.reloadStrangerList()),
    reload_guild_list: reloadAction(client => client.reloadGuilds()),
    reload_group_list: reloadAction(client => client.reloadGroupList()),
    reload_blacklist: reloadAction(client => client.reloadBlackList()),
    get_stranger_list: async (client: Client) => [...client.getStrangerList().values()],
    get_system_messages: async (client: Client) => client.getSystemMsg(),
    make_forward_message: makeForwardMessage,
    image_ocr: async (client: Client, params: Params) =>
        client.imageOcr(requiredString(params.file, "file")),
    get_video_url: async (client: Client, params: Params) =>
        client.getVideoUrl(requiredString(params.fid, "fid"), requiredString(params.md5, "md5")),
    get_group_share_json: async (client: Client, params: Params) =>
        client.getGroupShareJson(requiredQQNumber(params.group_id, "group_id")),
    get_group_avatar_url: async (client: Client, params: Params) =>
        client
            .pickGroup(requiredQQNumber(params.group_id, "group_id"))
            .getAvatarUrl(avatarSize(params.size), optionalInteger(params.history)),
    send_group_sign: async (client: Client, params: Params) =>
        client.sendGroupSign(requiredQQNumber(params.group_id, "group_id")),
    send_group_anonymous_message: sendGroupAnonymousMessage,
    get_group_at_all_remainder: groupAction(group => group.getAtAllRemainder()),
    get_group_mute_member_list: groupAction(group => group.getMuteMemberList()),
    get_group_anonymous_info: groupAction(group => group.getAnonyInfo()),
    set_group_message_rate_limit: setGroupMessageRateLimit,
    set_group_join_type: setGroupJoinType,
    set_group_remark: setGroupRemark,
    set_group_member_screen: async (client: Client, params: Params) =>
        client.setGroupMemberScreenMsg(
            requiredQQNumber(params.group_id, "group_id"),
            requiredQQNumber(params.user_id, "user_id"),
            optionalBoolean(params.enabled),
        ),
    delete_group_message_reaction: deleteGroupMessageReaction,
    add_group_member_as_friend: async (client: Client, params: Params) =>
        client.addFriend(
            requiredQQNumber(params.group_id, "group_id"),
            requiredQQNumber(params.user_id, "user_id"),
            optionalString(params.comment),
        ),
    get_forum_url: async (client: Client, params: Params) =>
        client.getForumUrl(
            requiredString(params.guild_id, "guild_id"),
            requiredString(params.channel_id, "channel_id"),
            requiredString(params.forum_id, "forum_id"),
        ),
    send_temp_message: async (client: Client, params: Params) =>
        client.sendTempMsg(
            requiredQQNumber(params.group_id, "group_id"),
            requiredQQNumber(params.user_id, "user_id"),
            platformMessage(params.message),
        ),
    send_discuss_message: async (client: Client, params: Params) =>
        client.sendDiscussMsg(
            requiredQQNumber(params.discuss_id, "discuss_id"),
            platformMessage(params.message),
        ),
    send_channel_share: sendChannelShare,
    get_group_file_system_info: async (client: Client, params: Params) =>
        client.acquireGfs(requiredQQNumber(params.group_id, "group_id")).df(),
    get_group_file_info: async (client: Client, params: Params) =>
        client
            .acquireGfs(requiredQQNumber(params.group_id, "group_id"))
            .stat(requiredString(params.file_id, "file_id")),
    get_group_file_entries: getGroupFileEntries,
    download_group_file: downloadGroupFile,
    forward_group_file: forwardGroupFile,
    get_offline_file_info: async (client: Client, params: Params) =>
        client
            .pickUser(requiredQQNumber(params.user_id, "user_id"))
            .getFileInfo(requiredString(params.file_id, "file_id")),
    forward_offline_file: async (client: Client, params: Params) =>
        client
            .pickFriend(requiredQQNumber(params.user_id, "user_id"))
            .forwardFile(
                requiredString(params.file_id, "file_id"),
                optionalQQNumber(params.group_id),
                optionalBoolean(params.send),
            ),
    forward_offline_file_to_group: async (client: Client, params: Params) =>
        client
            .acquireGfs(requiredQQNumber(params.group_id, "group_id"))
            .forwardOfflineFile(
                requiredString(params.file_id, "file_id"),
                optionalString(params.name),
                optionalBoolean(params.send),
            ),
} satisfies Readonly<Record<string, PlatformActionHandler<Client>>>;

const ACTION_PARAMETERS = {
    get_client_key: [],
    get_pskey: ["domains"],
    refresh_nt_pic_rkey: ["force"],
    uid_to_uin: ["uid", "group_id"],
    uin_to_uid: ["uin", "group_id"],
    get_online_status: [],
    set_online_status: ["status"],
    get_client_statistics: [],
    get_blacklist: [],
    get_friend_groups: [],
    set_gender: ["gender"],
    set_birthday: ["birthday"],
    set_description: ["description"],
    set_signature: ["signature"],
    get_profile: ["user_id"],
    get_add_friend_setting: ["user_id"],
    get_user_status: ["user_id", "use_jce"],
    get_user_avatar_url: ["user_id", "size"],
    set_friend_remark: ["user_id", "remark"],
    set_friend_group: ["user_id", "group_id"],
    search_same_groups: ["user_id"],
    get_roaming_stamps: ["no_cache"],
    delete_stamp: ["id"],
    add_friend_group: ["name"],
    delete_friend_group: ["id"],
    rename_friend_group: ["id", "name"],
    reload_friend_list: [],
    reload_stranger_list: [],
    reload_guild_list: [],
    reload_group_list: [],
    reload_blacklist: [],
    get_stranger_list: [],
    get_system_messages: [],
    make_forward_message: ["nodes", "dm"],
    image_ocr: ["file"],
    get_video_url: ["fid", "md5"],
    get_group_share_json: ["group_id"],
    get_group_avatar_url: ["group_id", "size", "history"],
    send_group_sign: ["group_id"],
    send_group_anonymous_message: ["group_id", "message", "anonymous"],
    get_group_at_all_remainder: ["group_id"],
    get_group_mute_member_list: ["group_id"],
    get_group_anonymous_info: ["group_id"],
    set_group_message_rate_limit: ["group_id", "times"],
    set_group_join_type: ["group_id", "type", "question", "answer"],
    set_group_remark: ["group_id", "remark"],
    set_group_member_screen: ["group_id", "user_id", "enabled"],
    delete_group_message_reaction: ["message_id", "group_id", "face_id", "face_type"],
    add_group_member_as_friend: ["group_id", "user_id", "comment"],
    get_forum_url: ["guild_id", "channel_id", "forum_id"],
    send_temp_message: ["group_id", "user_id", "message"],
    send_discuss_message: ["discuss_id", "message"],
    send_channel_share: [
        "guild_id",
        "channel_id",
        "url",
        "title",
        "summary",
        "content",
        "image",
        "audio",
        "config",
    ],
    get_group_file_system_info: ["group_id"],
    get_group_file_info: ["group_id", "file_id"],
    get_group_file_entries: ["group_id", "folder_id", "start", "limit"],
    download_group_file: ["group_id", "file_id"],
    forward_group_file: [
        "source_group_id",
        "target_group_id",
        "file_id",
        "target_folder_id",
        "name",
        "send",
    ],
    get_offline_file_info: ["user_id", "file_id"],
    forward_offline_file: ["user_id", "file_id", "group_id", "send"],
    forward_offline_file_to_group: ["group_id", "file_id", "name", "send"],
} satisfies { readonly [TAction in keyof typeof PLATFORM_ACTION_HANDLERS]: readonly string[] };

const PLATFORM_ACTIONS = definePlatformActionContract(PLATFORM_ACTION_HANDLERS, ACTION_PARAMETERS, {
    unsupported: action =>
        new ICQQError(`未实现 ICQQ 平台动作: ${action}`, {
            code: "ICQQ_ACTION_NOT_IMPLEMENTED",
            operation: action,
        }),
    unexpectedParameter: unexpectedICQQActionParameter,
});

export const ICQQ_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type ICQQPlatformAction =
    typeof ICQQ_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 调用 ICQQ 无法由通用 Adapter 语义准确表达的原生能力。 */
export async function executeICQQPlatformAction(
    client: Client,
    action: string,
    params: Params,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(client, action, params);
}

async function uidToUin(client: Client, params: Params): Promise<unknown> {
    return Array.isArray(params.uid)
        ? client.uid2uins(stringArray(params.uid, "uid"), optionalQQNumber(params.group_id))
        : client.uid2uin(requiredString(params.uid, "uid"), optionalQQNumber(params.group_id));
}

async function uinToUid(client: Client, params: Params): Promise<unknown> {
    return Array.isArray(params.uin)
        ? client.uin2uids(qqNumberArray(params.uin, "uin"), optionalQQNumber(params.group_id))
        : client.uin2uid(requiredQQNumber(params.uin, "uin"), optionalQQNumber(params.group_id));
}

function reloadAction(operation: (client: Client) => Promise<unknown>): Handler {
    return async client => operation(client);
}

function groupAction(
    operation: (group: ReturnType<Client["pickGroup"]>) => Promise<unknown>,
): Handler {
    return async (client, params) =>
        operation(client.pickGroup(requiredQQNumber(params.group_id, "group_id")));
}

function platformMessage(value: unknown) {
    if (!Array.isArray(value)) throw invalidICQQParam("message 必须是消息段数组", value);
    return compileICQQMessage(value as CommonTypes.Segment[]);
}

function gender(value: unknown): 0 | 1 | 2 {
    const result = requiredInteger(value, "gender");
    if (result !== 0 && result !== 1 && result !== 2) {
        throw invalidICQQParam("gender 只能是 0、1 或 2", value);
    }
    return result;
}

function groupMessageRate(value: unknown): 0 | 5 | 10 {
    const result = requiredInteger(value, "times");
    if (result !== 0 && result !== 5 && result !== 10) {
        throw invalidICQQParam("times 只能是 0、5 或 10", value);
    }
    return result;
}

function avatarSize(value: unknown): 0 | 40 | 100 | 140 | undefined {
    if (value === undefined) return undefined;
    const result = requiredInteger(value, "size");
    if (result === 0 || result === 40 || result === 100 || result === 140) return result;
    throw invalidICQQParam("size 只能是 0、40、100 或 140", value);
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
    throw invalidICQQParam("type 必须是 AnyOne、None、requireAuth、QAjoin 或 Correct", value);
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
        throw invalidICQQParam(`${type} 加群策略必须提供 question`, params);
    }
    if (type === "Correct" && !answer) {
        throw invalidICQQParam("Correct 加群策略必须提供 answer", params);
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
        throw icqqResourceNotFound("群消息", messageId);
    }
    if (
        params.group_id !== undefined &&
        message.group_id !== requiredQQNumber(params.group_id, "group_id")
    ) {
        throw invalidICQQParam("消息不属于指定群", {
            message_id: messageId,
            group_id: params.group_id,
        });
    }
    return client
        .pickGroup(message.group_id)
        .delReaction(
            message.seq,
            String(stringOrInteger(params.face_id, "face_id")),
            optionalInteger(params.face_type),
        );
}

async function sendChannelShare(client: Client, params: Params): Promise<void> {
    const guildId = requiredString(params.guild_id, "guild_id");
    const channelId = requiredString(params.channel_id, "channel_id");
    const channel = client.pickGuild(guildId).channels.get(channelId);
    if (!channel)
        throw icqqResourceNotFound("子频道", { guild_id: guildId, channel_id: channelId });
    await channel.share(channelShareContent(params), channelShareConfig(params.config));
}

async function forwardGroupFile(client: Client, params: Params): Promise<unknown> {
    const sourceGroupId = requiredQQNumber(params.source_group_id, "source_group_id");
    const targetGroupId =
        params.target_group_id === undefined
            ? sourceGroupId
            : requiredQQNumber(params.target_group_id, "target_group_id");
    const file = await client
        .acquireGfs(sourceGroupId)
        .stat(requiredString(params.file_id, "file_id"));
    if (!isGfsFile(file)) {
        throw invalidICQQParam("forward_group_file 只能转发文件", params.file_id);
    }
    return client
        .acquireGfs(targetGroupId)
        .forward(
            file,
            optionalString(params.target_folder_id),
            optionalString(params.name),
            optionalBoolean(params.send),
        );
}

function channelShareContent(params: Params) {
    return {
        url: requiredString(params.url, "url"),
        title: requiredString(params.title, "title"),
        summary: optionalString(params.summary),
        content: optionalString(params.content),
        image: optionalString(params.image),
        audio: optionalString(params.audio),
    };
}

function channelShareConfig(value: unknown) {
    if (value === undefined) return undefined;
    const config = record(value, "config");
    return {
        appid: requiredInteger(config.appid, "config.appid"),
        appname: optionalString(config.appname),
        appsign: optionalString(config.appsign),
    };
}

function isGfsFile(value: GfsFileStat | GfsDirStat): value is GfsFileStat {
    return !value.is_dir && "size" in value;
}
