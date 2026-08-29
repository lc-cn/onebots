import { coerceUnixToEventMs, type CommonEvent, type CommonTypes } from "onebots";
import { projectKookMessageSegments } from "./messages.js";
import type { KookEvent, KookSignal } from "./types.js";
import { stringValue } from "./utils.js";

export interface KookRawEvent {
    event: KookEvent;
    signal: KookSignal;
}

interface ProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

/** 投影全部 KOOK 消息与系统事件；未知系统事件作为 custom notice 无损交付。 */
export function projectKookEvent(
    event: KookEvent,
    signal: KookSignal,
    context: ProjectionContext,
): CommonEvent.Event<KookRawEvent> | undefined {
    const raw = { event, signal };
    if (event.type !== 255 && ["GROUP", "PERSON"].includes(event.channel_type)) {
        return projectMessage(event, raw, context);
    }
    if (event.type !== 255) return undefined;
    const eventType = String(event.extra.type || "unknown");
    const body = event.extra.body || {};
    const noticeType = NOTICE_TYPES[eventType] || "custom";
    const userId = stringValue(body.user_id || body.target_id || event.author_id);
    const groupId = stringValue(body.guild_id || event.extra.guild_id);
    const channelId = stringValue(body.channel_id || event.target_id);
    const messageId = stringValue(body.msg_id || event.msg_id);
    return {
        ...base(event, raw, context),
        type: "notice",
        notice_type: noticeType,
        user: userId ? { id: context.createId(userId), name: userId } : undefined,
        group:
            channelId || groupId
                ? {
                      id: context.createId(channelId || groupId),
                      name: event.extra.channel_name || "",
                  }
                : undefined,
        message_id: messageId ? context.createId(messageId) : undefined,
        message: body.content ? projectKookMessageSegments(9, String(body.content)) : undefined,
        extensions: {
            kook: {
                event_type: eventType,
                guild_id: groupId || undefined,
                channel_id: channelId || undefined,
                emoji: body.emoji,
                body,
            },
        },
    };
}

function projectMessage(
    event: KookEvent,
    raw: KookRawEvent,
    context: ProjectionContext,
): CommonEvent.Message<KookRawEvent> {
    const direct = event.channel_type === "PERSON";
    const author = event.extra.author;
    return {
        ...base(event, raw, context),
        type: "message",
        message_type: direct ? "private" : "channel",
        sender: {
            id: context.createId(event.author_id),
            name: author?.nickname || author?.username || event.author_id,
            avatar: author?.avatar,
        },
        group: direct
            ? undefined
            : { id: context.createId(event.target_id), name: event.extra.channel_name || "" },
        message_id: context.createId(event.msg_id),
        raw_message: event.content,
        message: projectKookMessageSegments(event.type, event.content, event.extra.mention),
        extensions: {
            kook: {
                guild_id: event.extra.guild_id,
                channel_code: event.extra.code,
                mention_all: event.extra.mention_all,
                mention_here: event.extra.mention_here,
                mention_roles: event.extra.mention_roles,
            },
        },
    };
}

function base(
    event: KookEvent,
    raw: KookRawEvent,
    context: ProjectionContext,
): CommonEvent.Base<KookRawEvent> {
    const eventType = String(event.extra.type || event.type);
    return {
        id: context.createId(
            event.msg_id || `${eventType}:${event.msg_timestamp}:${event.target_id}`,
        ),
        timestamp: coerceUnixToEventMs(event.msg_timestamp),
        type: "custom",
        platform: "kook",
        bot_id: context.botId,
        raw_event: raw,
    };
}

const NOTICE_TYPES: Record<string, CommonEvent.NoticeType> = {
    added_reaction: "reaction_added",
    private_added_reaction: "reaction_added",
    deleted_reaction: "reaction_removed",
    private_deleted_reaction: "reaction_removed",
    updated_message: "message_updated",
    updated_private_message: "message_updated",
    deleted_message: "message_deleted",
    deleted_private_message: "message_deleted",
    joined_guild: "member_joined",
    exited_guild: "member_left",
    updated_guild_member: "user_updated",
    user_updated: "user_updated",
    message_btn_click: "interaction",
};
