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
    return projectQQNotice(eventType, data, raw, eventId, timestamp, context);
}

function projectQQNotice(
    eventType: string,
    data: Record<string, unknown>,
    raw: unknown,
    eventId: string,
    timestamp: number,
    context: QQProjectionContext,
): CommonEvent.Notice {
    const user = projectEventUser(data, context);
    const group = projectEventGroup(eventType, data, context);
    const operatorId = firstText(data, "operator_id", "op_user_id", "op_member_openid");
    const messageId =
        firstText(data, "message_id", "target_id") ??
        nestedText(data, "target", "id") ??
        nestedText(data, "data", "resolved", "message_id");
    return {
        id: context.createId(eventId),
        timestamp,
        platform: "qq",
        bot_id: context.botId,
        type: "notice",
        notice_type: resolveNoticeType(eventType),
        sub_type: eventType.toLowerCase(),
        user,
        group,
        operator: operatorId ? { id: context.createId(operatorId) } : undefined,
        message_id: messageId ? context.createId(messageId) : undefined,
        raw_event: raw,
        extensions: {
            qq: {
                event_type: eventType,
                data: raw,
                ...(eventType.startsWith("MESSAGE_REACTION_")
                    ? {
                          emoji: data.emoji,
                          target: data.target,
                      }
                    : {}),
                ...(eventType === "INTERACTION_CREATE"
                    ? { interaction_id: text(data.id), interaction_data: data.data }
                    : {}),
            },
        },
    };
}

function projectEventUser(
    data: Record<string, unknown>,
    context: QQProjectionContext,
): CommonTypes.User | undefined {
    const rawUser = asRecord(data.user);
    const userId =
        firstText(data, "user_openid", "member_openid", "openid", "user_id") ??
        firstText(rawUser, "id", "user_openid", "member_openid") ??
        nestedText(data, "data", "resolved", "user_id");
    if (!userId) return undefined;
    return {
        id: context.createId(userId),
        name: firstText(rawUser, "username", "nickname") ?? firstText(data, "nick", "nickname"),
        avatar: text(rawUser.avatar),
    };
}

function projectEventGroup(
    eventType: string,
    data: Record<string, unknown>,
    context: QQProjectionContext,
): CommonTypes.Group | undefined {
    const guildId = text(data.guild_id);
    const channelId = text(data.channel_id);
    const groupId = firstText(data, "group_openid", "group_id");
    if (channelId) {
        return {
            id: context.createId(channelId),
            name: text(data.name),
            guild_id: guildId ? context.createId(guildId) : undefined,
            channel_id: context.createId(channelId),
        };
    }
    if (groupId) return { id: context.createId(groupId), name: text(data.group_name) };
    if (guildId) return { id: context.createId(guildId), name: text(data.name) };
    if (eventType.startsWith("GUILD_") && text(data.id)) {
        return { id: context.createId(text(data.id)!), name: text(data.name) };
    }
    if (eventType.startsWith("CHANNEL_") && text(data.id)) {
        const id = text(data.id)!;
        return {
            id: context.createId(id),
            name: text(data.name),
            channel_id: context.createId(id),
        };
    }
    return undefined;
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
    if (eventType === "FRIEND_DEL") return "friend_remove";
    if (eventType === "GROUP_ADD_ROBOT") return "group_increase";
    if (eventType === "GROUP_DEL_ROBOT") return "group_decrease";
    if (eventType.endsWith("MEMBER_ADD")) return "member_joined";
    if (eventType.endsWith("MEMBER_UPDATE")) return "user_updated";
    if (eventType.endsWith("MEMBER_REMOVE")) return "member_left";
    if (eventType.endsWith("MSG_REJECT") || eventType.endsWith("MSG_RECEIVE")) {
        return "message_status";
    }
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

function nestedText(data: Record<string, unknown>, ...path: string[]): string | undefined {
    let value: unknown = data;
    for (const key of path) value = asRecord(value)[key];
    return text(value);
}
