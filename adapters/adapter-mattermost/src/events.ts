import { sha256Json, type CommonEvent, type CommonTypes } from "onebots";
import { projectMattermostPost } from "./messages.js";
import type {
    MattermostChannel,
    MattermostDelivery,
    MattermostPost,
    MattermostWebSocketEvent,
} from "./types.js";

export interface MattermostProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
    resolveChannel(channelId: string): MattermostChannel | undefined;
}

/** 将 Mattermost WebSocket 全事件面投影为 canonical 事件；未知事件无损降为 custom。 */
export function projectMattermostEvent(
    delivery: MattermostDelivery,
    context: MattermostProjectionContext,
): CommonEvent.Event<MattermostWebSocketEvent>[] {
    const { event } = delivery;
    if ((event.event === "posted" || event.event === "ephemeral_message") && delivery.post) {
        return [messageEvent(delivery.post, event, context)];
    }
    if (event.event === "post_edited" && delivery.post) {
        return [postNotice("message_updated", delivery.post, event, context)];
    }
    if (event.event === "post_deleted" && delivery.post) {
        return [postNotice("message_deleted", delivery.post, event, context)];
    }
    if (
        (event.event === "reaction_added" || event.event === "reaction_removed") &&
        delivery.reaction
    ) {
        const reaction = delivery.reaction;
        return [
            {
                ...base(event, context),
                type: "notice",
                notice_type: event.event,
                message_id: context.createId(reaction.post_id),
                user: { id: context.createId(reaction.user_id) },
                group: groupFor(event, context),
                extensions: { mattermost: { reaction } },
            },
        ];
    }
    if (event.event === "typing") {
        const userId = stringValue(event.data.user_id);
        return [
            {
                ...base(event, context),
                type: "notice",
                notice_type: "typing_started",
                user: userId ? { id: context.createId(userId) } : undefined,
                group: groupFor(event, context),
                extensions: { mattermost: event.data },
            },
        ];
    }
    if (
        event.event === "status_change" ||
        event.event === "user_updated" ||
        event.event === "new_user"
    ) {
        const userId = delivery.user?.id || stringValue(event.data.user_id);
        return [
            resourceNotice(
                "user_updated",
                event,
                context,
                userId ? { type: "user", id: userId } : undefined,
            ),
        ];
    }
    if (["user_added", "direct_added", "group_added"].includes(event.event)) {
        return [membershipNotice("channel_subscriber_added", event, context)];
    }
    if (event.event === "user_removed") {
        return [membershipNotice("channel_subscriber_removed", event, context)];
    }
    if (["added_to_team"].includes(event.event)) {
        return [membershipNotice("member_joined", event, context)];
    }
    if (["leave_team"].includes(event.event)) {
        return [membershipNotice("member_left", event, context)];
    }
    if (["channel_created"].includes(event.event)) {
        return [
            resourceNotice("channel_created", event, context, channelResource(delivery, event)),
        ];
    }
    if (["channel_updated", "channel_converted", "channel_member_updated"].includes(event.event)) {
        return [
            resourceNotice("channel_updated", event, context, channelResource(delivery, event)),
        ];
    }
    if (event.event === "channel_deleted") {
        return [
            resourceNotice("channel_deleted", event, context, channelResource(delivery, event)),
        ];
    }
    if (event.event === "update_team") {
        return [resourceNotice("guild_updated", event, context, teamResource(delivery, event))];
    }
    if (event.event === "delete_team") {
        return [resourceNotice("guild_deleted", event, context, teamResource(delivery, event))];
    }
    if (event.event === "hello") {
        return [
            {
                ...base(event, context),
                type: "meta",
                meta_type: "lifecycle",
                sub_type: "connect",
                extensions: { mattermost: event.data },
            },
        ];
    }
    return [customNotice(event, context)];
}

function messageEvent(
    post: MattermostPost,
    event: MattermostWebSocketEvent,
    context: MattermostProjectionContext,
): CommonEvent.Message<MattermostWebSocketEvent> {
    const channel = resolveEventChannel(event, context);
    const scene = sceneFor(channel?.type || stringValue(event.data.channel_type));
    return {
        ...base(event, context, post.create_at),
        type: "message",
        message_type: scene,
        sender: {
            id: context.createId(post.user_id),
            name: stringValue(event.data.sender_name),
        },
        group: scene === "direct" ? undefined : groupFor(event, context, channel),
        message_id: context.createId(post.id),
        message: projectMattermostPost(post),
        raw_message: post.message,
        extensions: {
            mattermost: {
                post_type: post.type,
                root_id: post.root_id || undefined,
                props: post.props,
                ephemeral: event.event === "ephemeral_message",
            },
        },
    };
}

function postNotice(
    noticeType: "message_updated" | "message_deleted",
    post: MattermostPost,
    event: MattermostWebSocketEvent,
    context: MattermostProjectionContext,
): CommonEvent.Notice<MattermostWebSocketEvent> {
    return {
        ...base(event, context, post.update_at || post.delete_at || post.create_at),
        type: "notice",
        notice_type: noticeType,
        message_id: context.createId(post.id),
        user: { id: context.createId(post.user_id) },
        group: groupFor(event, context),
        message: noticeType === "message_updated" ? projectMattermostPost(post) : undefined,
        extensions: { mattermost: { post } },
    };
}

function membershipNotice(
    noticeType:
        | "channel_subscriber_added"
        | "channel_subscriber_removed"
        | "member_joined"
        | "member_left",
    event: MattermostWebSocketEvent,
    context: MattermostProjectionContext,
): CommonEvent.Notice<MattermostWebSocketEvent> {
    const userId = stringValue(event.data.user_id) || stringValue(event.data.added_user_id);
    return {
        ...base(event, context),
        type: "notice",
        notice_type: noticeType,
        user: userId ? { id: context.createId(userId) } : undefined,
        group: groupFor(event, context),
        extensions: { mattermost: event.data },
    };
}

function resourceNotice(
    noticeType: CommonEvent.Notice["notice_type"],
    event: MattermostWebSocketEvent,
    context: MattermostProjectionContext,
    resource?: { type: string; id: string; name?: string },
): CommonEvent.Notice<MattermostWebSocketEvent> {
    return {
        ...base(event, context),
        type: "notice",
        notice_type: noticeType,
        group: groupFor(event, context),
        resource:
            resource && resource.type !== "user"
                ? {
                      type: resource.type as CommonTypes.ResourceType,
                      id: context.createId(resource.id),
                      name: resource.name,
                  }
                : undefined,
        user: resource?.type === "user" ? { id: context.createId(resource.id) } : undefined,
        extensions: { mattermost: event.data },
    };
}

function customNotice(
    event: MattermostWebSocketEvent,
    context: MattermostProjectionContext,
): CommonEvent.Notice<MattermostWebSocketEvent> {
    return {
        ...base(event, context),
        type: "notice",
        notice_type: "custom",
        sub_type: event.event,
        group: groupFor(event, context),
        extensions: { mattermost: event.data },
    };
}

function base(
    event: MattermostWebSocketEvent,
    context: MattermostProjectionContext,
    timestamp = Date.now(),
): CommonEvent.Base<MattermostWebSocketEvent> {
    return {
        id: context.createId(`${event.event}:${event.seq}:${sha256Json(event)}`),
        timestamp,
        type: event.event,
        platform: "mattermost",
        bot_id: context.botId,
        raw_event: event,
    };
}

function groupFor(
    event: MattermostWebSocketEvent,
    context: MattermostProjectionContext,
    known?: MattermostChannel,
): CommonTypes.Group | undefined {
    const channelId = known?.id || event.broadcast.channel_id || stringValue(event.data.channel_id);
    if (!channelId) return undefined;
    const channel = known || context.resolveChannel(channelId);
    const type = channel?.type || stringValue(event.data.channel_type);
    if (type === "D") return undefined;
    const teamId = channel?.team_id || event.broadcast.team_id || stringValue(event.data.team_id);
    return {
        id: context.createId(channelId),
        channel_id: context.createId(channelId),
        guild_id: teamId ? context.createId(teamId) : undefined,
        name:
            channel?.display_name ||
            stringValue(event.data.channel_display_name) ||
            stringValue(event.data.channel_name),
        channel_type: type,
    };
}

function resolveEventChannel(
    event: MattermostWebSocketEvent,
    context: MattermostProjectionContext,
): MattermostChannel | undefined {
    const channelId = event.broadcast.channel_id || stringValue(event.data.channel_id);
    return channelId ? context.resolveChannel(channelId) : undefined;
}

function sceneFor(type?: string): CommonEvent.MessageScene {
    if (type === "D") return "direct";
    if (type === "G") return "group";
    return "channel";
}

function channelResource(
    delivery: MattermostDelivery,
    event: MattermostWebSocketEvent,
): { type: "channel"; id: string; name?: string } | undefined {
    const id =
        delivery.channel?.id || event.broadcast.channel_id || stringValue(event.data.channel_id);
    return id
        ? {
              type: "channel",
              id,
              name:
                  delivery.channel?.display_name ||
                  stringValue(event.data.channel_display_name) ||
                  stringValue(event.data.channel_name),
          }
        : undefined;
}

function teamResource(
    delivery: MattermostDelivery,
    event: MattermostWebSocketEvent,
): { type: "guild"; id: string; name?: string } | undefined {
    const id = delivery.team?.id || event.broadcast.team_id || stringValue(event.data.team_id);
    return id
        ? {
              type: "guild",
              id,
              name: delivery.team?.display_name || stringValue(event.data.team_display_name),
          }
        : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
