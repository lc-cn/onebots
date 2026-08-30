import { coerceUnixToEventMs, type CommonEvent, type CommonTypes } from "onebots";
import type { DingTalkEvent, DingTalkRobotMessage } from "./types.js";

interface DingTalkProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

/** 将 Stream/HTTP 收到的机器人消息投影为统一消息，并保留完整原始载荷。 */
export function projectDingTalkRobotMessage(
    message: DingTalkRobotMessage,
    raw: Record<string, unknown>,
    context: DingTalkProjectionContext,
): CommonEvent.Message<Record<string, unknown>> | undefined {
    if (!message.msgId || !message.senderId) return undefined;
    const isGroup = message.conversationType === "2";
    const senderId = message.senderStaffId || message.senderId;
    return {
        id: context.createId(message.msgId),
        timestamp: coerceUnixToEventMs(message.createAt),
        platform: "dingtalk",
        bot_id: context.botId,
        raw_event: raw,
        type: "message",
        message_type: isGroup ? "group" : "private",
        sender: {
            id: context.createId(senderId),
            name: message.senderNick || senderId,
        },
        group: isGroup
            ? {
                  id: context.createId(message.conversationId),
                  name: message.conversationTitle || "",
              }
            : undefined,
        message_id: context.createId(message.msgId),
        raw_message: message.text?.content || "",
        message: projectDingTalkSegments(message),
        extensions: {
            dingtalk: {
                sender_id: message.senderId,
                robot_code: message.robotCode,
                session_webhook_expires_at: message.sessionWebhookExpiredTime,
            },
        },
    };
}

/** 投影通讯录、群成员等开放平台事件；未知事件通过 custom notice 无损交付。 */
export function projectDingTalkEvents(
    event: DingTalkEvent,
    context: DingTalkProjectionContext,
): CommonEvent.Event<Record<string, unknown>>[] {
    const nestedMessage = objectValue(event.eventData.msg);
    if (nestedMessage.msgId) {
        const message = projectDingTalkRobotMessage(
            nestedMessage as DingTalkRobotMessage,
            event.raw,
            context,
        );
        return message ? [message] : [];
    }
    const noticeType = noticeTypes[event.eventType] || "custom";
    const userIds = stringList(
        event.eventData.UserId ||
            event.eventData.userId ||
            event.eventData.UserIds ||
            event.eventData.userIds,
    );
    const groupId = firstString(
        event.eventData.OpenConversationId,
        event.eventData.openConversationId,
        event.eventData.chatId,
        event.eventData.conversationId,
    );
    const operatorId = firstString(
        event.eventData.Operator,
        event.eventData.operator,
        event.eventData.operatorId,
    );
    const users = userIds.length ? userIds : [undefined];
    return users.map(userId => {
        const eventId = event.eventId || `${event.eventType}:${event.eventTime}`;
        return {
            id: context.createId(userIds.length > 1 ? `${eventId}:${userId}` : eventId),
            timestamp: coerceUnixToEventMs(event.eventTime),
            platform: "dingtalk",
            bot_id: context.botId,
            raw_event: event.raw,
            type: "notice",
            notice_type: noticeType,
            user: userId ? { id: context.createId(userId), name: userId } : undefined,
            operator: operatorId
                ? { id: context.createId(operatorId), name: operatorId }
                : undefined,
            group: groupId
                ? {
                      id: context.createId(groupId),
                      name: firstString(event.eventData.Title, event.eventData.title),
                  }
                : undefined,
            extensions: {
                dingtalk: {
                    event_type: event.eventType,
                    event_corp_id: event.eventCorpId,
                    user_ids: userIds,
                    ...cardCallbackExtensions(event),
                },
            },
        } satisfies CommonEvent.Notice<Record<string, unknown>>;
    });
}

function cardCallbackExtensions(event: DingTalkEvent): Readonly<Record<string, unknown>> {
    if (
        event.eventType !== "/v1.0/card/instances/callback" &&
        typeof event.eventData.outTrackId !== "string"
    ) {
        return {};
    }
    return {
        kind: "card_callback",
        out_track_id: firstString(event.eventData.outTrackId),
        user_id: firstString(event.eventData.userId),
        space_id: firstString(event.eventData.spaceId),
        space_type: firstString(event.eventData.spaceType),
        action_data: structuredValue(event.eventData.cardActionData),
    };
}

export function projectDingTalkSegments(message: DingTalkRobotMessage): CommonTypes.Segment[] {
    const type = message.msgtype || "unknown";
    const segments: CommonTypes.Segment[] = [];
    if (type === "text") {
        segments.push({ type: "text", data: { text: message.text?.content || "" } });
    } else if (["picture", "image"].includes(type)) {
        segments.push({ type: "image", data: mediaData(message) });
    } else if (["audio", "voice"].includes(type)) {
        segments.push({ type: "audio", data: mediaData(message) });
    } else if (type === "video") {
        segments.push({ type: "video", data: mediaData(message) });
    } else if (type === "file") {
        segments.push({ type: "file", data: mediaData(message) });
    } else if (type === "richText") {
        appendRichText(segments, message.richText);
    } else {
        segments.push({ type, data: objectValue(message.content) });
    }
    for (const user of message.atUsers || []) {
        const userId = user.staffId || user.dingtalkId;
        if (userId) segments.push({ type: "at", data: { user_id: userId } });
    }
    return segments;
}

function appendRichText(
    segments: CommonTypes.Segment[],
    richText: Record<string, unknown> | undefined,
): void {
    const items = Array.isArray(richText?.richText) ? richText.richText : [];
    for (const item of items) {
        const value = objectValue(item);
        if (typeof value.text === "string") {
            segments.push({ type: "text", data: { text: value.text } });
        } else {
            segments.push({ type: "image", data: mediaData(value) });
        }
    }
    if (!segments.length) segments.push({ type: "rich_text", data: richText || {} });
}

function mediaData(value: Record<string, unknown>): Record<string, unknown> {
    const content = objectValue(value.content);
    return {
        download_code: value.downloadCode || content.downloadCode,
        file_name: value.fileName || content.fileName,
        duration: value.duration || content.duration,
        url: value.picUrl || value.photoURL || content.picUrl || content.photoURL,
    };
}

function objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function structuredValue(value: unknown): unknown {
    if (value === undefined) return undefined;
    return structuredClone(value);
}

function firstString(...values: unknown[]): string {
    for (const value of values) if (typeof value === "string" && value) return value;
    return "";
}

function stringList(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter(item => typeof item === "string") as string[];
    return typeof value === "string" && value ? value.split(",").filter(Boolean) : [];
}

const noticeTypes: Record<string, CommonEvent.NoticeType> = {
    user_add_org: "user_added",
    user_modify_org: "user_updated",
    user_leave_org: "user_removed",
    chat_add_member: "member_joined",
    chat_remove_member: "member_left",
};
