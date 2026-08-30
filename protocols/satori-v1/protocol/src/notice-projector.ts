import type { CommonEvent } from "onebots";
import type { Satori } from "./types.js";

export interface SatoriNoticeProjectionContext {
    id: number;
    platform: string;
    selfId: string;
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
                : undefined,
        role:
            resource?.type === "role" ? { id: resource.id.string, name: resource.name } : undefined,
        member: type === "guild-member-updated" && user ? { user } : undefined,
    };
}

function satoriNoticeType(event: CommonEvent.Notice): Satori.EventType {
    const types: Readonly<Record<string, Satori.EventType>> = {
        group_increase: "guild-member-added",
        group_decrease: "guild-member-removed",
        guild_created: "guild-added",
        guild_updated: "guild-updated",
        guild_deleted: "guild-removed",
        channel_created: "channel-created",
        channel_updated: "channel-updated",
        channel_deleted: "channel-deleted",
        guild_role_created: "guild-role-created",
        guild_role_updated: "guild-role-updated",
        guild_role_deleted: "guild-role-deleted",
        friend_add: "friend-request",
    };
    if (event.notice_type === "user_updated" && event.group) return "guild-member-updated";
    return types[event.notice_type] || "internal";
}

function toSatoriChannelType(value: unknown): Satori.ChannelType {
    return value === 1 || value === 2 || value === 3 ? value : 0;
}
