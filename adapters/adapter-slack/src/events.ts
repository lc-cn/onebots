import { CommonEvent, unixSecondsToEventMs, type CommonTypes } from "onebots";
import { slackEventIdentity } from "./event-identity.js";
import type { SlackEvent, SlackMessage, SlackWebhookBody } from "./types.js";

interface ProjectorContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

interface SlackEventShape {
    type: string;
    event_ts?: string;
    ts?: string;
}

/** 投影 Slack Events API；未知事件仍以 custom notice 和 raw_event 无损交付。 */
export function projectSlackEvent(
    event: SlackEvent,
    envelope: SlackWebhookBody,
    context: ProjectorContext,
): CommonEvent.Event<SlackWebhookBody> | undefined {
    if (event.type === "message" || event.type === "app_mention") {
        if (event.subtype === "message_changed") {
            const message = objectValue(event.message) as SlackMessage;
            return notice(envelope, event, context, "message_updated", {
                message_id: context.createId(message.ts ?? event.ts ?? event.event_ts),
                message: projectSlackMessageSegments(message),
                user: projectUser(message.user, context),
                group: projectGroup(event.channel, context, envelope.team_id),
                extensions: {
                    slack: {
                        event_type: "message_changed",
                        previous_message: event.previous_message,
                    },
                },
            });
        }
        if (event.subtype === "message_deleted") {
            return notice(envelope, event, context, "message_deleted", {
                message_id: context.createId(stringValue(event.deleted_ts, event.event_ts)),
                group: projectGroup(event.channel, context, envelope.team_id),
            });
        }
        if (
            event.subtype &&
            !["thread_broadcast", "bot_message", "file_share", "me_message"].includes(event.subtype)
        ) {
            return notice(envelope, event, context, "custom", extension(event));
        }
        return projectMessage(event as SlackMessage, envelope, context);
    }

    switch (event.type) {
        case "reaction_added":
        case "reaction_removed": {
            const item = objectValue(event.item);
            return notice(
                envelope,
                event,
                context,
                event.type === "reaction_added" ? "reaction_added" : "reaction_removed",
                {
                    user: projectUser(event.user, context),
                    group: projectGroup(stringValue(item.channel), context, envelope.team_id),
                    message_id: item.ts ? context.createId(String(item.ts)) : undefined,
                    extensions: { slack: { reaction: event.reaction, item } },
                },
            );
        }
        case "member_joined_channel":
        case "member_left_channel":
            return notice(
                envelope,
                event,
                context,
                event.type === "member_joined_channel" ? "member_joined" : "member_left",
                {
                    user: projectUser(event.user, context),
                    group: projectGroup(event.channel, context, envelope.team_id),
                    extensions: { slack: { inviter: event.inviter } },
                },
            );
        case "team_join": {
            const user = objectValue(event.user);
            return notice(envelope, event, context, "user_added", {
                user: projectUser(stringValue(user.id), context, stringValue(user.name)),
            });
        }
        case "user_change": {
            const user = objectValue(event.user);
            return notice(envelope, event, context, "user_updated", {
                user: projectUser(stringValue(user.id), context, stringValue(user.name)),
            });
        }
        case "block_actions":
        case "view_submission":
        case "view_closed":
        case "shortcut":
        case "message_action":
        case "slash_command": {
            const user = objectValue(event.user);
            const channel = objectValue(event.channel);
            return notice(envelope, event, context, "interaction", {
                user: projectUser(
                    stringValue(user.id, stringValue(event.user_id)),
                    context,
                    stringValue(user.name, stringValue(event.user_name)),
                ),
                group: projectGroup(
                    stringValue(channel.id, stringValue(event.channel_id)),
                    context,
                    envelope.team_id,
                ),
                extensions: {
                    slack: {
                        event_type: event.type,
                        trigger_id: event.trigger_id,
                        callback_id: event.callback_id,
                        actions: event.actions,
                    },
                },
            });
        }
        case "app_rate_limited":
            return notice(envelope, event, context, "custom", extension(event));
        default:
            return notice(envelope, event, context, "custom", extension(event));
    }
}

function projectMessage(
    event: SlackMessage,
    envelope: SlackWebhookBody,
    context: ProjectorContext,
): CommonEvent.Event<SlackWebhookBody> {
    const channel = event.channel ?? "";
    const scene = slackMessageScene(event);
    const sender = projectUser(event.user ?? event.bot_id, context);
    if (!sender) {
        return notice(envelope, event, context, "custom", extension(event));
    }
    return {
        ...base(envelope, event, context),
        type: "message",
        message_type: scene,
        sender,
        group: scene === "private" ? undefined : projectGroup(channel, context, envelope.team_id),
        message_id: context.createId(event.ts ?? event.event_ts),
        raw_message: event.text ?? "",
        message: projectSlackMessageSegments(event),
    };
}

function slackMessageScene(event: SlackMessage): "private" | "direct" | "channel" {
    if (event.channel_type === "im" || event.channel.startsWith("D")) return "private";
    if (event.channel_type === "mpim") return "direct";
    return "channel";
}

export function projectSlackMessageSegments(event: SlackMessage): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (event.thread_ts && event.thread_ts !== event.ts) {
        segments.push({ type: "reply", data: { message_id: event.thread_ts } });
    }
    if (event.text) segments.push({ type: "text", data: { text: event.text } });
    for (const file of event.files ?? []) {
        const type = file.mimetype?.startsWith("image/")
            ? "image"
            : file.mimetype?.startsWith("audio/")
              ? "audio"
              : file.mimetype?.startsWith("video/")
                ? "video"
                : "file";
        segments.push({
            type,
            data: { file: file.id, url: file.url_private, filename: file.name, size: file.size },
        });
    }
    return segments;
}

function notice(
    envelope: SlackWebhookBody,
    event: SlackEventShape,
    context: ProjectorContext,
    noticeType: CommonEvent.NoticeType,
    fields: Omit<Partial<CommonEvent.Notice<SlackWebhookBody>>, keyof CommonEvent.Base | "type">,
): CommonEvent.Notice<SlackWebhookBody> {
    return {
        ...base(envelope, event, context),
        type: "notice",
        notice_type: noticeType,
        ...fields,
    };
}

function base(
    envelope: SlackWebhookBody,
    event: SlackEventShape,
    context: ProjectorContext,
): CommonEvent.Base<SlackWebhookBody> {
    const timestamp = unixSecondsToEventMs(event.ts ?? event.event_ts);
    return {
        id: context.createId(slackEventIdentity(envelope)),
        timestamp,
        type: "custom",
        platform: "slack",
        bot_id: context.botId,
        raw_event: envelope,
    };
}

function projectUser(
    id: unknown,
    context: ProjectorContext,
    name = "",
): CommonTypes.User | undefined {
    return typeof id === "string" && id
        ? { id: context.createId(id), name: name || id }
        : undefined;
}

function projectGroup(
    id: unknown,
    context: ProjectorContext,
    teamId?: string,
): CommonTypes.Group | undefined {
    return typeof id === "string" && id
        ? {
              id: context.createId(id),
              name: "",
              ...(teamId ? { guild_id: context.createId(teamId) } : {}),
              channel_id: context.createId(id),
          }
        : undefined;
}

function extension(event: SlackEventShape): { extensions: { slack: { event_type: string } } } {
    return { extensions: { slack: { event_type: event.type } } };
}

function objectValue(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" && value ? value : fallback;
}
