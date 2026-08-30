import { dateLikeToEventMs, sha256Json, type CommonEvent, type CommonTypes } from "onebots";
import { projectTeamsSegments } from "./activity.js";
import type { TeamsActivity, TeamsEvent, TeamsUser } from "./types.js";

export type TeamsProjectionKind =
    | "private_message"
    | "group_message"
    | "message_updated"
    | "message_deleted"
    | "member_joined"
    | "member_left"
    | "group_increase"
    | "group_decrease"
    | "reaction_added"
    | "reaction_removed"
    | "message_status"
    | "interaction"
    | "custom";

export interface TeamsProjectionContext {
    botId: string;
    createId(value: string | number): CommonTypes.Id;
}

/** 为非消息 Activity 选择稳定投影；不确定语义时保持 custom。 */
export function resolveTeamsProjectionKind(event: TeamsEvent): TeamsProjectionKind {
    if (event.activity.type === "invoke") return "interaction";
    if (
        event.activity.type === "event" &&
        event.activity.name === "application/vnd.microsoft.readReceipt" &&
        lastReadMessageId(event.activity)
    ) {
        return "message_status";
    }
    const conversationType = event.activity.conversation.conversationType;
    const isGroup =
        event.activity.conversation.isGroup === true ||
        conversationType === "channel" ||
        conversationType === "groupChat";
    if (event.activity.type === "installationUpdate" && isGroup) {
        if (event.activity.action === "add") return "group_increase";
        if (event.activity.action === "remove") return "group_decrease";
    }
    return "custom";
}

/** 将全部 Teams Activity 无损投影为通用消息或 notice。 */
export function projectTeamsEvent(
    kind: TeamsProjectionKind,
    event: TeamsEvent,
    context: TeamsProjectionContext,
): CommonEvent.Event<TeamsEvent> {
    const activity = event.activity;
    const base = createBase(activity, event, context);
    if (kind === "private_message" || kind === "group_message") {
        const isGroup = kind === "group_message";
        return {
            ...base,
            type: "message",
            message_type:
                activity.conversation.conversationType === "channel"
                    ? "channel"
                    : isGroup
                      ? "group"
                      : "private",
            sender: projectUser(activity.from, context),
            group: isGroup ? projectGroup(activity, context) : undefined,
            message_id: context.createId(activity.id),
            raw_message: activity.text || "",
            message: projectTeamsSegments(activity),
            extensions: teamsExtensions(activity),
        };
    }

    const noticeType = NOTICE_TYPES[kind];
    const member =
        kind === "member_joined"
            ? activity.membersAdded?.[0]
            : kind === "member_left"
              ? activity.membersRemoved?.[0]
              : kind === "group_increase" || kind === "group_decrease"
                ? activity.recipient
                : activity.from;
    return {
        ...base,
        id: context.createId(`${base.id.string}:${kind}:${noticeIdentity(kind, activity, member)}`),
        type: "notice",
        notice_type: noticeType,
        message_id: messageIdForNotice(kind, activity, context),
        message: kind === "message_updated" ? projectTeamsSegments(activity) : undefined,
        user: member?.id ? projectUser(member, context) : undefined,
        group: isGroupActivity(activity) ? projectGroup(activity, context) : undefined,
        extensions: {
            ...teamsExtensions(activity),
            teams: {
                ...teamsExtensions(activity).teams,
                projection_kind: kind,
                activity_type: activity.type,
                activity_name: activity.name,
                value: activity.value,
                reactions:
                    kind === "reaction_added"
                        ? activity.reactionsAdded
                        : kind === "reaction_removed"
                          ? activity.reactionsRemoved
                          : undefined,
                status: kind === "message_status" ? "read" : undefined,
                last_read_message_id:
                    kind === "message_status" ? lastReadMessageId(activity) : undefined,
            },
        },
    };
}

function noticeIdentity(
    kind: TeamsProjectionKind,
    activity: TeamsActivity,
    member?: TeamsUser,
): string {
    if (["member_joined", "member_left", "group_increase", "group_decrease"].includes(kind)) {
        return member?.id || "unknown";
    }
    if (kind === "reaction_added") return activity.reactionsAdded?.[0]?.type || "unknown";
    if (kind === "reaction_removed") return activity.reactionsRemoved?.[0]?.type || "unknown";
    if (kind === "message_status") return lastReadMessageId(activity) || "unknown";
    return activity.name || activity.replyToId || activity.id || "event";
}

function createBase(
    activity: TeamsActivity,
    rawEvent: TeamsEvent,
    context: TeamsProjectionContext,
): CommonEvent.Base<TeamsEvent> {
    const fallbackId = `${activity.type}:sha256:${sha256Json(activity)}`;
    return {
        id: context.createId(activity.id || fallbackId),
        timestamp: dateLikeToEventMs(activity.timestamp),
        type: "custom",
        platform: "teams",
        bot_id: context.createId(context.botId),
        raw_event: rawEvent,
    };
}

function projectUser(user: TeamsUser, context: TeamsProjectionContext): CommonTypes.User {
    return {
        id: context.createId(user.id),
        name: user.name,
        aad_object_id: user.aadObjectId,
        tenant_id: user.tenantId,
        role: user.role,
    };
}

function projectGroup(activity: TeamsActivity, context: TeamsProjectionContext): CommonTypes.Group {
    const isChannel = activity.conversation.conversationType === "channel";
    const teamId = activity.channelData?.team?.id;
    return {
        id: context.createId(activity.conversation.id),
        name: activity.conversation.name || activity.channelData?.channel?.name || "",
        ...(isChannel && teamId ? { guild_id: context.createId(teamId) } : {}),
        ...(isChannel ? { channel_id: context.createId(activity.conversation.id) } : {}),
        team_id: activity.channelData?.team?.id,
        native_channel_id: activity.channelData?.channel?.id,
        tenant_id: activity.channelData?.tenant?.id || activity.conversation.tenantId,
    };
}

function teamsExtensions(activity: TeamsActivity): { teams: Record<string, unknown> } {
    return {
        teams: {
            service_url: activity.serviceUrl,
            conversation_type: activity.conversation.conversationType,
            tenant_id: activity.channelData?.tenant?.id || activity.conversation.tenantId,
            team_id: activity.channelData?.team?.id,
            channel_id: activity.channelData?.channel?.id,
            reply_to_id: activity.replyToId,
            locale: activity.locale,
            importance: activity.importance,
            channel_data: activity.channelData,
        },
    };
}

function isGroupActivity(activity: TeamsActivity): boolean {
    return Boolean(
        activity.conversation.isGroup ||
        ["channel", "groupChat"].includes(activity.conversation.conversationType || ""),
    );
}

function messageRelated(kind: TeamsProjectionKind): boolean {
    return [
        "message_status",
        "message_updated",
        "message_deleted",
        "reaction_added",
        "reaction_removed",
    ].includes(kind);
}

function messageIdForNotice(
    kind: TeamsProjectionKind,
    activity: TeamsActivity,
    context: TeamsProjectionContext,
): CommonTypes.Id | undefined {
    if (!messageRelated(kind)) return undefined;
    const id =
        kind === "message_status"
            ? lastReadMessageId(activity)
            : kind.startsWith("reaction_")
              ? activity.replyToId || activity.id
              : activity.id;
    return id ? context.createId(id) : undefined;
}

const NOTICE_TYPES: Record<
    Exclude<TeamsProjectionKind, "private_message" | "group_message">,
    CommonEvent.NoticeType
> = {
    message_updated: "message_updated",
    message_deleted: "message_deleted",
    member_joined: "member_joined",
    member_left: "member_left",
    group_increase: "group_increase",
    group_decrease: "group_decrease",
    reaction_added: "reaction_added",
    reaction_removed: "reaction_removed",
    message_status: "message_status",
    interaction: "interaction",
    custom: "custom",
};

function lastReadMessageId(activity: TeamsActivity): string | undefined {
    if (!activity.value || typeof activity.value !== "object" || Array.isArray(activity.value)) {
        return undefined;
    }
    const value = (activity.value as Record<string, unknown>).lastReadMessageId;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export { projectTeamsSegments } from "./activity.js";
