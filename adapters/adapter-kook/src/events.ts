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
    if (eventType === "guild_member_online" || eventType === "guild_member_offline") {
        return projectPresenceEvents(event, raw, body, context, eventType);
    }
    return [projectSystemNotice(event, raw, body, context, eventType)];
}

function projectSystemNotice(
    event: KookEvent,
    raw: KookRawEvent,
    body: Record<string, unknown>,
    context: ProjectionContext,
    eventType: string,
    guildOverride?: string,
): CommonEvent.Notice<KookRawEvent> {
    const resourceDefinition = RESOURCE_EVENTS[eventType];
    const noticeType = resourceDefinition?.noticeType || NOTICE_TYPES[eventType] || "custom";
    const bodyUser = objectValue(body.user_info);
    const userId = systemUserId(eventType, body, bodyUser);
    const resource = projectResource(resourceDefinition, body, context);
    const guildId =
        guildOverride ||
        (resource?.type === "guild" ? resource.id.string : "") ||
        stringValue(
            body.guild_id ||
                event.extra.guild_id ||
                (event.channel_type === "GROUP" ? event.target_id : ""),
        );
    const channelId =
        (resource?.type === "channel" ? resource.id.string : "") || stringValue(body.channel_id);
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
                        name: stringValue(
                            body.nickname ||
                                body.username ||
                                bodyUser.nickname ||
                                bodyUser.username ||
                                userId,
                        ),
                        avatar: stringValue(body.avatar || bodyUser.avatar) || undefined,
                    }
                  : undefined,
        operator: userValue(body.operator_id, context),
        group: projectGroup(guildId, channelId, event.extra.channel_name, context),
        message_id: messageId ? context.createId(messageId) : undefined,
        message: body.content ? projectKookEditableContent(body.content) : undefined,
        resource,
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
                ...(eventType === "guild_member_online" || eventType === "guild_member_offline"
                    ? {
                          online: eventType === "guild_member_online",
                          guilds: stringArray(body.guilds),
                      }
                    : {}),
                body,
            },
        },
    };
}

function projectPresenceEvents(
    event: KookEvent,
    raw: KookRawEvent,
    body: Record<string, unknown>,
    context: ProjectionContext,
    eventType: "guild_member_online" | "guild_member_offline",
): CommonEvent.Notice<KookRawEvent>[] {
    const guilds = stringArray(body.guilds);
    if (!guilds.length) return [projectSystemNotice(event, raw, body, context, eventType)];
    return guilds.map(guildId => ({
        ...projectSystemNotice(event, raw, body, context, eventType, guildId),
        id: context.createId(`${event.msg_id}:${guildId}`),
    }));
}

function systemUserId(
    eventType: string,
    body: Record<string, unknown>,
    bodyUser: Record<string, unknown>,
): string {
    if (RESOURCE_EVENTS[eventType]) return "";
    if (eventType === "updated_guild_member") {
        return stringValue(body.id || body.user_id);
    }
    return stringValue(body.user_id || bodyUser.id || body.author_id || body.target_id);
}

function projectResource(
    definition: ResourceEventDefinition | undefined,
    body: Record<string, unknown>,
    context: ProjectionContext,
): CommonTypes.Resource | undefined {
    if (!definition) return undefined;
    const id = identifier(definition.type === "role" ? body.role_id : body.id);
    if (!id) return undefined;
    return {
        type: definition.type,
        id: context.createId(id),
        name: stringValue(body.name) || undefined,
        ...(definition.type === "channel"
            ? {
                  channel_type: numericValue(body.type),
                  parent_id: stringValue(body.parent_id) || undefined,
              }
            : {}),
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

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
}

function identifier(value: unknown): string {
    if (typeof value === "string") return value;
    return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";
}

function numericValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
    guild_member_online: "user_updated",
    guild_member_offline: "user_updated",
    user_updated: "user_updated",
    message_btn_click: "interaction",
    pinned_message: "message_status",
    unpinned_message: "message_status",
    self_joined_guild: "group_increase",
    self_exited_guild: "group_decrease",
    joined_channel: "member_joined",
    exited_channel: "member_left",
};

interface ResourceEventDefinition {
    type: CommonTypes.ResourceType;
    noticeType: CommonEvent.NoticeType;
}

const RESOURCE_EVENTS: Readonly<Record<string, ResourceEventDefinition>> = {
    updated_guild: { type: "guild", noticeType: "guild_updated" },
    deleted_guild: { type: "guild", noticeType: "guild_deleted" },
    added_channel: { type: "channel", noticeType: "channel_created" },
    updated_channel: { type: "channel", noticeType: "channel_updated" },
    deleted_channel: { type: "channel", noticeType: "channel_deleted" },
    added_role: { type: "role", noticeType: "guild_role_created" },
    updated_role: { type: "role", noticeType: "guild_role_updated" },
    deleted_role: { type: "role", noticeType: "guild_role_deleted" },
    added_emoji: { type: "emoji", noticeType: "emoji_created" },
    updated_emoji: { type: "emoji", noticeType: "emoji_updated" },
    removed_emoji: { type: "emoji", noticeType: "emoji_deleted" },
};
