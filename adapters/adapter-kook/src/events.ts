import { coerceUnixToEventMs, type CommonEvent, type CommonTypes } from "onebots";
import { projectKookEditableContent, projectKookMessageSegments } from "./messages.js";
import type { KookEvent, KookSignal } from "./types.js";
import { stringValue } from "./utils.js";

export interface KookRawEvent {
    event: KookEvent;
    signal: KookSignal;
}

interface ProjectionContext {
    botId: CommonTypes.Id;
    selfId?: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

/** 投影全部 KOOK 消息与系统事件；批量系统事件会拆为稳定的逐对象 notice。 */
export function projectKookEvents(
    event: KookEvent,
    signal: KookSignal,
    context: ProjectionContext,
): CommonEvent.Event<KookRawEvent>[] {
    const raw = { event, signal };
    if (event.type !== 255 && ["GROUP", "PERSON"].includes(event.channel_type)) {
        return [projectMessage(event, raw, context)];
    }
    if (event.type !== 255) return [];
    const eventType = String(event.extra.type || "unknown");
    const body = event.extra.body || {};
    if (eventType === "added_block_list" || eventType === "deleted_block_list") {
        return projectGuildBans(event, raw, body, context, eventType === "added_block_list");
    }
    return [projectSystemNotice(event, raw, body, context, eventType)];
}

function projectSystemNotice(
    event: KookEvent,
    raw: KookRawEvent,
    body: Record<string, unknown>,
    context: ProjectionContext,
    eventType: string,
): CommonEvent.Notice<KookRawEvent> {
    const noticeType = NOTICE_TYPES[eventType] || "custom";
    const bodyUser = objectValue(body.user_info);
    const userId = stringValue(body.user_id || bodyUser.id || body.author_id || body.target_id);
    const guildId = stringValue(
        body.guild_id ||
            event.extra.guild_id ||
            (event.channel_type === "GROUP" ? event.target_id : ""),
    );
    const channelId = stringValue(body.channel_id);
    const messageId = stringValue(body.msg_id);
    return {
        ...base(event, raw, context),
        type: "notice",
        notice_type: noticeType,
        user:
            eventType === "self_joined_guild" || eventType === "self_exited_guild"
                ? { id: context.selfId || context.botId, name: "" }
                : userId
                  ? {
                        id: context.createId(userId),
                        name: stringValue(bodyUser.nickname || bodyUser.username || userId),
                        avatar: stringValue(bodyUser.avatar) || undefined,
                    }
                  : undefined,
        operator: userValue(body.operator_id, context),
        group: projectGroup(guildId, channelId, event.extra.channel_name, context),
        message_id: messageId ? context.createId(messageId) : undefined,
        message: body.content ? projectKookEditableContent(body.content) : undefined,
        sub_type: eventType,
        extensions: {
            kook: {
                event_type: eventType,
                guild_id: guildId || undefined,
                channel_id: channelId || undefined,
                emoji: body.emoji,
                chat_code: body.chat_code,
                updated_at: body.updated_at,
                deleted_at: body.deleted_at,
                body,
            },
        },
    };
}

function projectGuildBans(
    event: KookEvent,
    raw: KookRawEvent,
    body: Record<string, unknown>,
    context: ProjectionContext,
    banned: boolean,
): CommonEvent.Notice<KookRawEvent>[] {
    const users = Array.isArray(body.user_id)
        ? body.user_id.filter((value): value is string => typeof value === "string" && !!value)
        : stringValue(body.user_id)
          ? [stringValue(body.user_id)]
          : [];
    if (!users.length) {
        return [
            projectSystemNotice(
                event,
                raw,
                body,
                context,
                banned ? "added_block_list" : "deleted_block_list",
            ),
        ];
    }
    const guildId = stringValue(
        body.guild_id ||
            event.extra.guild_id ||
            (event.channel_type === "GROUP" ? event.target_id : ""),
    );
    return users.map(userId => ({
        ...base(event, raw, context),
        id: context.createId(`${event.msg_id}:${userId}`),
        type: "notice",
        notice_type: "group_ban",
        sub_type: banned ? "ban" : "lift_ban",
        user: { id: context.createId(userId), name: userId },
        operator: userValue(body.operator_id, context),
        group: projectGroup(guildId, "", "", context),
        extensions: {
            kook: {
                event_type: banned ? "added_block_list" : "deleted_block_list",
                remark: body.remark,
                users,
                body,
            },
        },
    }));
}

function projectGroup(
    guildId: string,
    channelId: string,
    name: unknown,
    context: ProjectionContext,
): CommonTypes.Group | undefined {
    if (!guildId && !channelId) return undefined;
    return {
        id: context.createId(channelId || guildId),
        name: stringValue(name),
        ...(guildId ? { guild_id: context.createId(guildId) } : {}),
        ...(channelId ? { channel_id: context.createId(channelId) } : {}),
    };
}

function userValue(value: unknown, context: ProjectionContext): CommonTypes.User | undefined {
    const id = stringValue(value);
    return id ? { id: context.createId(id), name: id } : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
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
            : {
                  id: context.createId(event.target_id),
                  name: event.extra.channel_name || "",
                  ...(event.extra.guild_id
                      ? { guild_id: context.createId(event.extra.guild_id) }
                      : {}),
                  channel_id: context.createId(event.target_id),
              },
        message_id: context.createId(event.msg_id),
        raw_message: stringValue(event.content),
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
    pinned_message: "message_status",
    unpinned_message: "message_status",
    self_joined_guild: "group_increase",
    self_exited_guild: "group_decrease",
    joined_channel: "member_joined",
    exited_channel: "member_left",
};
