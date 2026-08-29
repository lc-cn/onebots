import type { Adapter, CommonTypes } from "onebots";
import type { HeychatChannelInfo, HeychatUserInfo } from "./types.js";

type CreateId = (value: string | number) => CommonTypes.Id;

/** 将房间成员投影为 canonical GroupMember，保持转换逻辑与网络动作分离。 */
export function projectHeychatGroupMember(
    createId: CreateId,
    roomId: string,
    user: HeychatUserInfo,
): Adapter.GroupMemberInfo {
    return {
        group_id: createId(roomId),
        user_id: createId(user.user_id),
        user_name: user.nickname || user.username || String(user.user_id),
        card: user.room_nickname,
        role: "member",
    };
}

/** 展平官方房间视图的频道树，供目录与单频道查询共享。 */
export function flattenHeychatChannels(
    channels: readonly HeychatChannelInfo[],
): HeychatChannelInfo[] {
    return channels.flatMap(channel => [
        channel,
        ...flattenHeychatChannels(channel.channel_list || []),
    ]);
}

export function projectHeychatChannel(
    createId: CreateId,
    roomId: string,
    channel: HeychatChannelInfo,
): Adapter.ChannelInfo {
    return {
        channel_id: createId(`${roomId}:${channel.channel_id}`),
        channel_name: channel.channel_name || channel.channel_id,
        channel_type: channel.channel_type,
        ...(channel.parent_id ? { parent_id: createId(`${roomId}:${channel.parent_id}`) } : {}),
    };
}
