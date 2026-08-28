import { dateLikeToEventMs, type CommonEvent, type CommonTypes } from "onebots";
import type { TeamsActivity, TeamsEvent, TeamsUser } from "./types.js";

export type TeamsProjectionKind =
    | "private_message"
    | "group_message"
    | "message_updated"
    | "message_deleted"
    | "member_joined"
    | "member_left";

export interface TeamsProjectionContext {
    botId: string;
    createId(value: string | number): CommonTypes.Id;
}

/** 将 Bot Framework Activity 无副作用地投影成 CommonEvent，便于独立契约测试。 */
export function projectTeamsEvent(
    kind: TeamsProjectionKind,
    event: TeamsEvent,
    context: TeamsProjectionContext,
): CommonEvent.Event<TeamsEvent> {
    const activity = event.activity;
    const base = {
        id: context.createId(activity.id),
        timestamp: dateLikeToEventMs(activity.timestamp),
        platform: "teams",
        bot_id: context.createId(context.botId),
        raw_event: event,
    };

    if (kind === "private_message" || kind === "group_message") {
        const isGroup = kind === "group_message";
        return {
            ...base,
            type: "message",
            message_type: isGroup ? "group" : "private",
            sender: projectUser(activity.from, context),
            group: isGroup ? projectGroup(activity, context) : undefined,
            message_id: context.createId(activity.id),
            raw_message: activity.text ?? "",
            message: projectTeamsSegments(activity),
        };
    }

    const noticeTypes: Record<
        Exclude<TeamsProjectionKind, "private_message" | "group_message">,
        CommonEvent.NoticeType
    > = {
        message_updated: "message_updated",
        message_deleted: "message_deleted",
        member_joined: "member_joined",
        member_left: "member_left",
    };
    const noticeType = noticeTypes[kind];
    const member =
        kind === "member_joined"
            ? (activity.membersAdded?.[0] ?? activity.from)
            : kind === "member_left"
              ? (activity.membersRemoved?.[0] ?? activity.from)
              : activity.from;

    return {
        ...base,
        id: kind === "member_joined" || kind === "member_left"
            ? context.createId(`${activity.id}:${kind}:${member.id}`)
            : base.id,
        type: "notice",
        notice_type: noticeType,
        message_id: kind.startsWith("message_") ? context.createId(activity.id) : undefined,
        message: kind === "message_updated" ? projectTeamsSegments(activity) : undefined,
        user: projectUser(member, context),
        group: activity.conversation.isGroup ? projectGroup(activity, context) : undefined,
    };
}

export function projectTeamsSegments(activity: TeamsActivity): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (activity.text) {
        segments.push({ type: "text", data: { text: activity.text } });
    }
    for (const attachment of activity.attachments ?? []) {
        const type = attachment.contentType?.startsWith("image/")
            ? "image"
            : attachment.contentType?.startsWith("video/")
              ? "video"
              : attachment.contentType?.startsWith("audio/")
                ? "audio"
                : "file";
        segments.push({
            type,
            data: { url: attachment.contentUrl, name: attachment.name },
        });
    }
    return segments.length > 0 ? segments : [{ type: "text", data: { text: "" } }];
}

function projectUser(user: TeamsUser, context: TeamsProjectionContext): CommonTypes.User {
    return {
        id: context.createId(user.id),
        name: user.name || "",
    };
}

function projectGroup(activity: TeamsActivity, context: TeamsProjectionContext): CommonTypes.Group {
    return {
        id: context.createId(activity.conversation.id),
        name: activity.conversation.name || "",
    };
}
