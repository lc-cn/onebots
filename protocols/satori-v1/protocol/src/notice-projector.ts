import type { CommonEvent } from "onebots";
import type { Satori } from "./types.js";

export interface SatoriNoticeProjectionContext {
    id: number;
    platform: string;
    selfId: string;
    convertMessageContent?(segments: CommonEvent.Notice["message"]): string;
}

/** 将通用 notice 投影到 Satori 原生资源生命周期事件。 */
export function projectSatoriNotice(
    event: CommonEvent.Notice,
    context: SatoriNoticeProjectionContext,
): Satori.Event {
    const type = satoriNoticeType(event);
    const user = event.user
        ? {
              id: event.user.id.string,
              name: event.user.name,
              avatar: event.user.avatar,
          }
        : undefined;
    const resource = event.resource;
    const channelId = event.group?.channel_id?.string ?? event.group?.id.string;
    const guild =
        resource?.type === "guild"
            ? { id: resource.id.string, name: resource.name }
            : event.group?.guild_id
              ? { id: event.group.guild_id.string }
              : event.group && !event.group.channel_id
                ? { id: event.group.id.string, name: event.group.name }
                : undefined;

    return {
        id: context.id,
        type,
        platform: context.platform,
        self_id: context.selfId,
        timestamp: event.timestamp,
        user,
        guild,
        channel:
            resource?.type === "channel"
                ? {
                      id: resource.id.string,
                      type: toSatoriChannelType(resource.channel_type),
                      name: resource.name,
                      parent_id:
                          typeof resource.parent_id === "string" ? resource.parent_id : undefined,
                  }
                : channelId
                  ? { id: channelId, type: 0, name: event.group?.name }
                  : undefined,
        role:
            resource?.type === "role" ? { id: resource.id.string, name: resource.name } : undefined,
        emoji:
            resource?.type === "emoji"
                ? { id: resource.id.string, name: resource.name }
                : typeof event.face_id === "string"
                  ? { id: event.face_id }
                  : undefined,
        member: type.startsWith("guild-member-") && user ? { user } : undefined,
        message:
            type === "message-updated" || type === "message-deleted" || type.startsWith("reaction-")
                ? event.message_id
                    ? {
                          id: event.message_id.string,
                          content: context.convertMessageContent?.(event.message) ?? "",
                          ...(type === "message-updated" ? { updated_at: event.timestamp } : {}),
                      }
                    : undefined
                : undefined,
        operator: event.operator
            ? {
                  id: event.operator.id.string,
                  name: event.operator.name,
                  avatar: event.operator.avatar,
              }
            : undefined,
        ...(type === "internal"
            ? {
                  _type: `${event.platform}.${event.notice_type}`,
                  _data: {
                      notice_type: event.notice_type,
                      extensions: event.extensions,
                      raw_event: event.raw_event,
                  },
              }
            : {}),
    };
}

function satoriNoticeType(event: CommonEvent.Notice): Satori.EventType {
    const types: Readonly<Record<string, Satori.EventType>> = {
        group_increase: "guild-member-added",
        group_decrease: "guild-member-removed",
        member_joined: "guild-member-added",
        member_left: "guild-member-removed",
        message_updated: "message-updated",
        message_deleted: "message-deleted",
        reaction_added: "reaction-added",
        reaction_removed: "reaction-removed",
        guild_created: "guild-added",
        guild_updated: "guild-updated",
        guild_deleted: "guild-removed",
        channel_created: "channel-added",
        channel_updated: "channel-updated",
        channel_deleted: "channel-removed",
        guild_role_created: "guild-role-created",
        guild_role_updated: "guild-role-updated",
        guild_role_deleted: "guild-role-deleted",
        emoji_created: "guild-emoji-added",
        emoji_updated: "guild-emoji-updated",
        emoji_deleted: "guild-emoji-removed",
    };
    const type =
        event.notice_type === "user_updated" && event.group
            ? "guild-member-updated"
            : types[event.notice_type] || "internal";
    return hasRequiredResources(type, event) ? type : "internal";
}

/** Satori 标准事件要求对应资源齐全；信息不足时保留为 internal，禁止伪造空资源。 */
function hasRequiredResources(type: Satori.EventType, event: CommonEvent.Notice): boolean {
    const hasGuild =
        event.resource?.type === "guild" ||
        Boolean(event.group?.guild_id || (event.group && !event.group.channel_id));
    const hasChannel =
        event.resource?.type === "channel" || Boolean(event.group?.channel_id || event.group?.id);
    if (type.startsWith("guild-member-")) return hasGuild && Boolean(event.user);
    if (type.startsWith("guild-role-")) return hasGuild && event.resource?.type === "role";
    if (type.startsWith("guild-emoji-")) return hasGuild && event.resource?.type === "emoji";
    if (type.startsWith("channel-")) {
        return hasGuild && event.resource?.type === "channel";
    }
    if (type.startsWith("message-")) {
        return hasChannel && Boolean(event.message_id && event.user);
    }
    if (type.startsWith("reaction-")) {
        const hasEmoji = event.resource?.type === "emoji" || typeof event.face_id === "string";
        return hasChannel && hasEmoji && Boolean(event.message_id && event.user);
    }
    if (type.startsWith("guild-")) return hasGuild;
    return true;
}

function toSatoriChannelType(value: unknown): Satori.ChannelType {
    return value === 1 || value === 2 || value === 3 ? value : 0;
}
