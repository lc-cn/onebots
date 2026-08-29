import type { CommonEvent, CommonTypes } from "onebots";
import { buildCommandText } from "./utils.js";
import type {
    HeychatCardClickData,
    HeychatChannelContext,
    HeychatReactionData,
    HeychatRoomMemberData,
    HeychatUseCommandData,
    HeychatUserInfo,
    HeychatWsEnvelope,
} from "./types.js";

export interface HeychatEventProjectionOptions {
    accountId: string;
    botId?: number | null;
    createId(value: string | number): CommonTypes.Id;
    getChannelContext?(channelId: string): HeychatChannelContext | undefined;
}

/** 将官方列出的四类推送投影为通用事件，未知推送仍作为 custom 无损交付。 */
export function projectHeychatEvent(
    envelope: HeychatWsEnvelope,
    options: HeychatEventProjectionOptions,
): CommonEvent.Event<HeychatWsEnvelope> | null {
    switch (envelope.type) {
        case "50":
            return projectCommand(envelope, options);
        case "5003":
            return projectReaction(envelope, options);
        case "3001":
            return projectRoomMember(envelope, options);
        case "card_message_btn_click":
            return projectCardClick(envelope, options);
        default:
            return customNotice(envelope, options);
    }
}

function projectCommand(
    envelope: HeychatWsEnvelope,
    options: HeychatEventProjectionOptions,
): CommonEvent.Message<HeychatWsEnvelope> | null {
    const data = envelope.data as HeychatUseCommandData;
    const room = data.room_base_info;
    const channel = data.channel_base_info;
    const sender = data.sender_info;
    if (!room?.room_id || !channel?.channel_id || !sender) return null;

    const messageId = data.msg_id || String(envelope.sequence);
    const rawMessage = buildCommandText(data.command_info);
    return {
        ...base(envelope, options, data.bot_id),
        type: "message",
        message_type: "channel",
        sender: projectUser(sender, options),
        group: {
            id: options.createId(`${room.room_id}:${channel.channel_id}`),
            name: channel.channel_name || room.room_name || channel.channel_id,
            room_id: options.createId(room.room_id),
            channel_id: options.createId(channel.channel_id),
        },
        message_id: options.createId(messageId),
        raw_message: rawMessage,
        message: [{ type: "text", data: { text: rawMessage } }],
        raw_event: envelope,
        extensions: {
            heychat: {
                event_type: "command",
                command: data.command_info,
                room,
                channel,
            },
        },
    };
}

function projectReaction(
    envelope: HeychatWsEnvelope,
    options: HeychatEventProjectionOptions,
): CommonEvent.Notice<HeychatWsEnvelope> | null {
    const data = envelope.data as HeychatReactionData;
    if (
        !data.channel_id ||
        !data.msg_id ||
        data.user_id === undefined ||
        (data.is_add !== 0 && data.is_add !== 1)
    ) {
        return null;
    }
    const context = options.getChannelContext?.(data.channel_id);
    const groupId = context ? `${context.room_id}:${context.channel_id}` : data.channel_id;
    return {
        ...base(envelope, options),
        type: "notice",
        notice_type: data.is_add === 1 ? "reaction_added" : "reaction_removed",
        user: { id: options.createId(data.user_id) },
        group: { id: options.createId(groupId), name: context?.channel_name },
        message_id: options.createId(data.msg_id),
        raw_event: envelope,
        extensions: { heychat: { emoji: data.emoji, channel_id: data.channel_id } },
    };
}

function projectRoomMember(
    envelope: HeychatWsEnvelope,
    options: HeychatEventProjectionOptions,
): CommonEvent.Notice<HeychatWsEnvelope> | null {
    const data = envelope.data as HeychatRoomMemberData;
    if (
        !data.room_base_info?.room_id ||
        !data.user_info ||
        (data.state !== 0 && data.state !== 1)
    ) {
        return null;
    }
    return {
        ...base(envelope, options),
        type: "notice",
        notice_type: data.state === 1 ? "member_joined" : "member_left",
        user: projectUser(data.user_info, options),
        group: {
            id: options.createId(data.room_base_info.room_id),
            name: data.room_base_info.room_name,
        },
        raw_event: envelope,
        extensions: { heychat: { state: data.state, room: data.room_base_info } },
    };
}

function projectCardClick(
    envelope: HeychatWsEnvelope,
    options: HeychatEventProjectionOptions,
): CommonEvent.Notice<HeychatWsEnvelope> {
    const data = envelope.data as HeychatCardClickData;
    const user = data.sender_info || data.user_info;
    const room = data.room_base_info;
    const channel = data.channel_base_info;
    return {
        ...base(envelope, options),
        type: "notice",
        notice_type: "interaction",
        ...(user ? { user: projectUser(user, options) } : {}),
        ...(room
            ? {
                  group: {
                      id: options.createId(
                          channel ? `${room.room_id}:${channel.channel_id}` : room.room_id,
                      ),
                      name: channel?.channel_name || room.room_name,
                  },
              }
            : {}),
        ...(data.msg_id ? { message_id: options.createId(data.msg_id) } : {}),
        raw_event: envelope,
        extensions: { heychat: { interaction: data } },
    };
}

function customNotice(
    envelope: HeychatWsEnvelope,
    options: HeychatEventProjectionOptions,
): CommonEvent.Notice<HeychatWsEnvelope> {
    return {
        ...base(envelope, options),
        type: "notice",
        notice_type: "custom",
        raw_event: envelope,
        extensions: {
            heychat: { event_type: envelope.type, notify_type: envelope.notify_type },
        },
    };
}

function base(
    envelope: HeychatWsEnvelope,
    options: HeychatEventProjectionOptions,
    eventBotId?: number,
): Pick<CommonEvent.Base, "id" | "timestamp" | "platform" | "bot_id"> {
    return {
        id: options.createId(String(envelope.sequence)),
        timestamp: normalizeTimestamp(envelope.timestamp),
        platform: "heychat",
        bot_id: options.createId(eventBotId ?? options.botId ?? options.accountId),
    };
}

function projectUser(
    user: HeychatUserInfo,
    options: HeychatEventProjectionOptions,
): CommonTypes.User {
    return {
        id: options.createId(user.user_id),
        name: user.room_nickname || user.nickname || user.username || String(user.user_id),
        avatar: user.avatar,
        bot: user.bot,
        roles: user.roles,
        level: user.level,
    };
}

function normalizeTimestamp(value: number): number {
    return value > 0 && value < 10_000_000_000 ? value * 1000 : value || Date.now();
}
