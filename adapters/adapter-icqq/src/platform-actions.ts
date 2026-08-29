import type { Client } from "@icqqjs/icqq";
import type { GfsDirStat, GfsFileStat } from "@icqqjs/icqq/lib/gfs";
import { definePlatformActions, type CommonTypes, type PlatformActionHandler } from "onebots";
import { compileICQQMessage } from "./messages.js";
import { ICQQError, icqqResourceNotFound, invalidICQQParam } from "./errors.js";

type Params = Readonly<Record<string, unknown>>;
type Handler = PlatformActionHandler<Client>;

const PLATFORM_ACTIONS = definePlatformActions(
    {
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
        set_gender: async (client: Client, params: Params) =>
            client.setGender(gender(params.gender)),
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
            client.renameClass(
                requiredInteger(params.id, "id"),
                requiredString(params.name, "name"),
            ),
        reload_friend_list: reloadAction(client => client.reloadFriendList()),
        reload_stranger_list: reloadAction(client => client.reloadStrangerList()),
        reload_guild_list: reloadAction(client => client.reloadGuilds()),
        reload_group_list: reloadAction(client => client.reloadGroupList()),
        reload_blacklist: reloadAction(client => client.reloadBlackList()),
        get_stranger_list: async (client: Client) => [...client.getStrangerList().values()],
        image_ocr: async (client: Client, params: Params) =>
            client.imageOcr(requiredString(params.file, "file")),
        get_video_url: async (client: Client, params: Params) =>
            client.getVideoUrl(
                requiredString(params.fid, "fid"),
                requiredString(params.md5, "md5"),
            ),
        get_group_share_json: async (client: Client, params: Params) =>
            client.getGroupShareJson(requiredQQNumber(params.group_id, "group_id")),
        send_group_sign: async (client: Client, params: Params) =>
            client.sendGroupSign(requiredQQNumber(params.group_id, "group_id")),
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
    },
    action =>
        new ICQQError(`未实现 ICQQ 平台动作: ${action}`, {
            code: "ICQQ_ACTION_NOT_IMPLEMENTED",
            operation: action,
        }),
);

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

function requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value)
        throw invalidICQQParam(`${field} 必须是非空字符串`, value);
    return value;
}

function optionalString(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw invalidICQQParam("参数必须是字符串", value);
    return value;
}

function requiredInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw invalidICQQParam(`${field} 必须是安全整数`, value);
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
    if (typeof value !== "boolean") throw invalidICQQParam("参数必须是布尔值", value);
    return value;
}

function stringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) throw invalidICQQParam(`${field} 必须是字符串数组`, value);
    return value.map(item => requiredString(item, field));
}

function qqNumberArray(value: unknown, field: string): number[] {
    if (!Array.isArray(value)) throw invalidICQQParam(`${field} 必须是整数数组`, value);
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

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) {
        throw invalidICQQParam(`${field} 必须是对象`, value);
    }
    return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGfsFile(value: GfsFileStat | GfsDirStat): value is GfsFileStat {
    return !value.is_dir && "size" in value;
}
