import {
    requireNonEmptyStringParam,
    requirePositiveIntegerParam,
    type Adapter,
    type CommonTypes,
} from "onebots";
import { projectOneBotV12Actions } from "./supported-actions.js";
import { OneBotV12 } from "./types.js";

type Params = Record<string, unknown>;
type Handler = (params: Params) => Promise<unknown>;

export interface OneBotV12ActionContext {
    readonly adapter: Adapter;
    readonly accountId: string;
    readonly getSelfInfo: () => OneBotV12.BotSelf;
    readonly convertToCommonSegments: (segments: OneBotV12.Segment[]) => CommonTypes.Segment[];
}

/** OneBot V12 标准动作目录，并统一承接 Adapter 的平台原生动作回退。 */
export class OneBotV12ActionService {
    private readonly actions: Readonly<Record<string, Handler>>;

    constructor(private readonly context: OneBotV12ActionContext) {
        const { adapter, accountId } = context;
        const platformAction =
            (action: string): Handler =>
            async params => {
                if (adapter.describeCapabilities(accountId).actions[action]) {
                    return adapter.callAction(accountId, action, params);
                }
                throw new Error(`${action} not implemented`);
            };
        this.actions = {
            send_message: async rawParams => {
                const params = rawParams as unknown as OneBotV12.SendMessageParams;
                const { detail_type, user_id, group_id, guild_id, channel_id, message } = params;
                let sceneType: CommonTypes.Scene;
                let sceneId: string;
                if (detail_type === "private" && user_id) {
                    sceneType = "private";
                    sceneId = user_id;
                } else if (detail_type === "group" && group_id) {
                    sceneType = "group";
                    sceneId = group_id;
                } else if (detail_type === "channel" && guild_id && channel_id) {
                    sceneType = "channel";
                    sceneId = channel_id;
                } else {
                    throw new Error("Invalid message parameters");
                }
                const result = await adapter.sendMessage(accountId, {
                    scene_type: sceneType,
                    scene_id: adapter.resolveId(sceneId),
                    ...(detail_type === "channel" && guild_id
                        ? { guild_id: adapter.resolveId(guild_id) }
                        : {}),
                    message: context.convertToCommonSegments(message),
                });
                return {
                    message_id: result.message_id.string,
                    time: Math.floor(Date.now() / 1000),
                } satisfies OneBotV12.SendMessageResponse;
            },
            delete_message: async rawParams => {
                const params = rawParams as unknown as OneBotV12.DeleteMessageParams;
                await adapter.deleteMessage(accountId, {
                    message_id: adapter.resolveId(params.message_id),
                });
            },
            get_self_info: async () => ({
                user_id: adapter.resolveId(accountId).string,
                user_name: accountId,
                user_displayname: accountId,
            }),
            get_supported_actions: async () =>
                projectOneBotV12Actions(adapter.describeCapabilities(accountId)),
            get_status: async () => {
                const status = await adapter.getStatus(accountId);
                return {
                    good: status.good,
                    bots: [{ self: context.getSelfInfo(), online: status.online ?? status.good }],
                } satisfies OneBotV12.Status;
            },
            get_version: async () => this.getVersionInfo(),
            get_user_info: async rawParams => {
                const params = rawParams as unknown as OneBotV12.GetUserInfoParams;
                const user = await adapter.getUserInfo(accountId, {
                    user_id: adapter.resolveId(params.user_id),
                });
                return { user_id: user.user_id.string, user_name: user.user_name };
            },
            get_friend_list: async () => {
                const friends = await adapter.getFriendList(accountId);
                return friends.map(friend => ({
                    user_id: friend.user_id.string,
                    user_name: friend.user_name,
                    user_remark: friend.remark,
                }));
            },
            get_group_info: async rawParams => {
                const params = rawParams as unknown as OneBotV12.GetGroupInfoParams;
                const group = await adapter.getGroupInfo(accountId, {
                    group_id: adapter.resolveId(params.group_id),
                });
                return { group_id: group.group_id.string, group_name: group.group_name };
            },
            get_group_list: async () => {
                const groups = await adapter.getGroupList(accountId);
                return groups.map(group => ({
                    group_id: group.group_id.string,
                    group_name: group.group_name,
                }));
            },
            get_group_member_info: async rawParams => {
                const params = rawParams as unknown as OneBotV12.GetGroupMemberInfoParams;
                const member = await adapter.getGroupMemberInfo(accountId, {
                    group_id: adapter.resolveId(params.group_id),
                    user_id: adapter.resolveId(params.user_id),
                });
                return { user_id: member.user_id.string, user_name: member.user_name };
            },
            get_group_member_list: async rawParams => {
                const params = rawParams as unknown as OneBotV12.GetGroupMemberListParams;
                const members = await adapter.getGroupMemberList(accountId, {
                    group_id: adapter.resolveId(params.group_id),
                });
                return members.map(member => ({
                    user_id: member.user_id.string,
                    user_name: member.user_name,
                }));
            },
            set_group_name: async rawParams => {
                const params = rawParams as unknown as OneBotV12.SetGroupNameParams;
                await adapter.setGroupName(accountId, {
                    group_id: adapter.resolveId(params.group_id),
                    group_name: params.group_name,
                });
            },
            leave_group: async rawParams => {
                const params = rawParams as unknown as OneBotV12.LeaveGroupParams;
                await adapter.leaveGroup(accountId, {
                    group_id: adapter.resolveId(params.group_id),
                });
            },
            invite_friend_to_group: async params => {
                await adapter.inviteGroupMember(accountId, {
                    group_id: adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
                    user_id: adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
                });
                return {};
            },
            accept_friend_request: async params => {
                await adapter.handleFriendRequest(accountId, {
                    flag: requireNonEmptyStringParam(params, "flag"),
                    approve: true,
                    remark: typeof params.remark === "string" ? params.remark : undefined,
                });
                return {};
            },
            get_guild_info: async rawParams => {
                const params = rawParams as unknown as OneBotV12.GetGuildInfoParams;
                const guild = await adapter.getGuildInfo(accountId, {
                    guild_id: adapter.resolveId(params.guild_id),
                });
                return { guild_id: guild.guild_id.string, guild_name: guild.guild_name };
            },
            get_guild_list: async () => {
                const guilds = await adapter.getGuildList(accountId);
                return guilds.map(guild => ({
                    guild_id: guild.guild_id.string,
                    guild_name: guild.guild_name,
                }));
            },
            get_guild_member_info: async rawParams => {
                const params = rawParams as unknown as OneBotV12.GetGuildMemberInfoParams;
                const member = await adapter.getGuildMemberInfo(accountId, {
                    guild_id: adapter.resolveId(params.guild_id),
                    user_id: adapter.resolveId(params.user_id),
                });
                return {
                    user_id: member.user_id.string,
                    user_name: member.user_name,
                    user_displayname: member.nickname,
                };
            },
            get_guild_member_list: async rawParams => {
                const params = rawParams as unknown as OneBotV12.GetGuildMemberListParams;
                const members = await adapter.getGuildMemberList(accountId, {
                    guild_id: adapter.resolveId(params.guild_id),
                });
                return members.map(member => ({
                    user_id: member.user_id.string,
                    user_name: member.user_name,
                    user_displayname: member.nickname,
                }));
            },
            get_channel_info: async rawParams => {
                const params = rawParams as unknown as OneBotV12.GetChannelInfoParams;
                const channel = await adapter.getChannelInfo(accountId, {
                    channel_id: adapter.resolveId(params.channel_id),
                    guild_id: adapter.resolveId(params.guild_id),
                });
                return {
                    channel_id: channel.channel_id.string,
                    channel_name: channel.channel_name,
                };
            },
            get_channel_list: async rawParams => {
                const params = rawParams as unknown as OneBotV12.GetChannelListParams;
                const channels = await adapter.getChannelList(accountId, {
                    guild_id: adapter.resolveId(params.guild_id),
                });
                return channels.map(channel => ({
                    channel_id: channel.channel_id.string,
                    channel_name: channel.channel_name,
                }));
            },
            set_channel_name: async rawParams => {
                const params = rawParams as unknown as OneBotV12.SetChannelNameParams;
                await adapter.updateChannel(accountId, {
                    channel_id: adapter.resolveId(params.channel_id),
                    channel_name: params.channel_name,
                });
            },
            get_channel_member_info: async rawParams => {
                const params = rawParams as unknown as OneBotV12.GetChannelMemberInfoParams;
                const member = await adapter.getChannelMemberInfo(accountId, {
                    channel_id: adapter.resolveId(params.channel_id),
                    user_id: adapter.resolveId(params.user_id),
                });
                return {
                    user_id: member.user_id.string,
                    user_name: member.user_name,
                    user_displayname: member.user_name,
                };
            },
            get_channel_member_list: async rawParams => {
                const params = rawParams as unknown as OneBotV12.GetChannelMemberListParams;
                const members = await adapter.getChannelMemberList(accountId, {
                    channel_id: adapter.resolveId(params.channel_id),
                });
                return members.map(member => ({
                    user_id: member.user_id.string,
                    user_name: member.user_name,
                    user_displayname: member.user_name,
                }));
            },
            upload_file: platformAction("upload_file"),
            upload_file_fragmented_prepare: platformAction("upload_file_fragmented_prepare"),
            upload_file_fragmented_transfer: platformAction("upload_file_fragmented_transfer"),
            upload_file_fragmented_finish: platformAction("upload_file_fragmented_finish"),
            get_file: platformAction("get_file"),
            get_file_fragmented_prepare: platformAction("get_file_fragmented_prepare"),
            get_file_fragmented_transfer: platformAction("get_file_fragmented_transfer"),
        };
    }

    async execute(action: string, params: Params = {}): Promise<unknown> {
        const handler = this.actions[action];
        if (handler) return handler(params);
        const { adapter, accountId } = this.context;
        if (adapter.describeCapabilities(accountId).actions[action]) {
            return adapter.callAction(accountId, action, params);
        }
        throw new Error(`Unknown action: ${action}`);
    }

    async getVersionInfo(): Promise<OneBotV12.VersionInfo> {
        const version = await this.context.adapter.getVersion(this.context.accountId);
        return {
            impl: version.impl ?? version.app_name ?? "onebots",
            version: version.version ?? version.app_version ?? "unknown",
            onebot_version: "12",
        };
    }
}
