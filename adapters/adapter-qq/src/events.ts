import type { QQBotInboundMessage } from "@tencent-connect/qqbot-nodejs";
import { dateLikeToEventMs, type CommonEvent, type CommonTypes } from "onebots";

export interface QQProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

type QQMessageProjectionInput = Omit<QQBotInboundMessage, "replyTarget"> &
    Partial<Pick<QQBotInboundMessage, "replyTarget">>;

export function projectQQMessage<TEvent extends QQMessageProjectionInput>(
    event: TEvent,
    context: QQProjectionContext,
): CommonEvent.Message<TEvent["raw"]> {
    const scene =
        event.kind === "c2c"
            ? "private"
            : event.kind === "guild"
              ? "channel"
              : event.kind === "dm"
                ? "direct"
                : "group";
    const groupId = event.groupOpenid;
    const channelId = event.channelId;
    return {
        id: context.createId(event.messageId),
        timestamp: dateLikeToEventMs(event.timestamp),
        platform: "qq",
        bot_id: context.botId,
        type: "message",
        message_type: scene,
        sender: { id: context.createId(event.senderId), name: event.senderName },
        group:
            scene === "group" && groupId
                ? { id: context.createId(groupId) }
                : scene === "channel" && channelId && event.guildId
                  ? {
                        id: context.createId(channelId),
                        guild_id: context.createId(event.guildId),
                        channel_id: context.createId(channelId),
                    }
                  : undefined,
        message_id: context.createId(event.messageId),
        raw_message: event.content,
        message: projectMessageSegments(event),
        raw_event: event.raw,
        extensions: {
            qq: {
                raw_event_type: event.rawEventType,
                channel_id: event.channelId,
                guild_id: event.guildId,
                message_scene: event.messageScene,
                msg_idx: event.msgIdx,
                ref_msg_idx: event.refMsgIdx,
            },
        },
    };
}

export function projectQQRawEvent(
    eventType: string,
    raw: unknown,
    context: QQProjectionContext,
): CommonEvent.Notice | CommonEvent.Request | CommonEvent.Meta {
    const data = asRecord(raw);
    const eventId = text(data.id) ?? text(data.event_id) ?? `${eventType}:${Date.now()}`;
    const timestamp = dateLikeToEventMs(
        text(data.timestamp) ?? text(data.time) ?? text(data.event_time) ?? Date.now(),
    );
    if (eventType === "READY" || eventType === "RESUMED") {
        return {
            id: context.createId(eventId),
            timestamp,
            platform: "qq",
            bot_id: context.botId,
            type: "meta",
            meta_type: "lifecycle",
            sub_type: eventType.toLowerCase(),
            raw_event: raw,
        };
    }
    const userId = firstText(data, "user_openid", "member_openid", "openid", "user_id");
    const groupId = firstText(data, "group_openid", "guild_id", "group_id");
    if (eventType === "GROUP_JOIN_REQUEST" || eventType === "GROUP_ADD_REQUEST") {
        return {
            id: context.createId(eventId),
            timestamp,
            platform: "qq",
            bot_id: context.botId,
            type: "request",
            request_type: "group",
            sub_type: "add",
            user: { id: context.createId(userId ?? "unknown") },
            group: groupId ? { id: context.createId(groupId) } : undefined,
            comment: text(data.comment) ?? text(data.message),
            flag: firstText(data, "join_request_id", "request_id") ?? eventId,
            raw_event: raw,
        };
    }
    const noticeType = resolveNoticeType(eventType);
    return {
        id: context.createId(eventId),
        timestamp,
        platform: "qq",
        bot_id: context.botId,
        type: "notice",
        notice_type: noticeType,
        sub_type: eventType.toLowerCase(),
        user: userId ? { id: context.createId(userId) } : undefined,
        group: groupId ? { id: context.createId(groupId) } : undefined,
        operator: firstText(data, "operator_id", "op_user_id")
            ? { id: context.createId(firstText(data, "operator_id", "op_user_id")!) }
            : undefined,
        message_id: firstText(data, "message_id", "target_id")
            ? context.createId(firstText(data, "message_id", "target_id")!)
            : undefined,
        raw_event: raw,
        extensions: { qq: { event_type: eventType, data: raw } },
    };
}

function projectMessageSegments(event: QQMessageProjectionInput): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (event.refMsgIdx) {
        segments.push({
            type: "reply",
            data: { id: event.refMsgIdx, message_id: event.refMsgIdx },
        });
    }
    for (const mention of event.mentions ?? []) {
        const id = mention.user_openid ?? mention.member_openid ?? mention.id;
        if (mention.scope === "all") segments.push({ type: "at", data: { qq: "all" } });
        else if (id)
            segments.push({
                type: "at",
                data: { qq: id, name: mention.nickname ?? mention.username },
            });
    }
    if (event.content) segments.push({ type: "text", data: { text: event.content } });
    for (const attachment of event.attachments ?? []) {
        const type = mediaSegmentType(attachment.content_type);
        segments.push({
            type,
            data: {
                url: attachment.url,
                file: attachment.url,
                name: attachment.filename,
                content_type: attachment.content_type,
                voice_wav_url: attachment.voice_wav_url,
                asr_text: attachment.asr_refer_text,
            },
        });
    }
    return segments;
}

function mediaSegmentType(contentType: string): string {
    if (contentType.startsWith("image/")) return "image";
    if (contentType.startsWith("audio/")) return "audio";
    if (contentType.startsWith("video/")) return "video";
    return "file";
}

function resolveNoticeType(eventType: string): CommonEvent.NoticeType {
    if (eventType === "FRIEND_ADD") return "friend_add";
    if (eventType.endsWith("MEMBER_ADD")) return "member_joined";
    if (eventType.endsWith("MEMBER_REMOVE")) return "member_left";
    if (eventType === "MESSAGE_REACTION_ADD") return "reaction_added";
    if (eventType === "MESSAGE_REACTION_REMOVE") return "reaction_removed";
    if (eventType === "INTERACTION_CREATE") return "interaction";
    return "custom";
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function firstText(data: Record<string, unknown>, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = text(data[key]);
        if (value) return value;
    }
    return undefined;
}
