import { CommonEvent, coerceUnixToEventMs, sha256Json, type CommonTypes } from "onebots";
import type { FeishuEvent, FeishuWebhookBody } from "./types.js";

interface ProjectorContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

/** 投影飞书 2.0 事件；未知事件仍以 custom notice 和 raw_event 无损交付。 */
export function projectFeishuEvents(
    event: FeishuEvent,
    rawEvent: FeishuWebhookBody,
    context: ProjectorContext,
): CommonEvent.Event<FeishuWebhookBody>[] {
    const eventType = event.header.event_type;
    const payload = objectValue(event.event);
    switch (eventType) {
        case "im.message.receive_v1":
            return singleton(projectMessage(event, rawEvent, payload, context));
        case "im.message.recalled_v1":
            return [
                notice(event, rawEvent, context, "message_deleted", {
                    message_id: idValue(payload.message_id, context),
                    group: groupValue(payload.chat_id, context),
                    extensions: {
                        feishu: {
                            event_type: eventType,
                            recall_time: stringValue(payload.recall_time),
                            recall_type: stringValue(payload.recall_type),
                        },
                    },
                }),
            ];
        case "im.message.message_read_v1":
            return projectMessageReads(event, rawEvent, payload, context);
        case "im.message.reaction.created_v1":
        case "im.message.reaction.deleted_v1":
            return [projectReaction(event, rawEvent, payload, context)];
        case "im.chat.member.user.added_v1":
        case "im.chat.member.user.deleted_v1": {
            const users = Array.isArray(payload.users) ? payload.users : [];
            return users.map((value, index) => {
                const user = objectValue(value);
                const projected = notice(
                    event,
                    rawEvent,
                    context,
                    eventType.endsWith("added_v1") ? "member_joined" : "member_left",
                    {
                        user: userValue(user, context),
                        operator: userValue(objectValue(payload.operator_id), context),
                        group: groupValue(payload.chat_id, context, payload.name),
                        extensions: { feishu: { event_type: eventType, users } },
                    },
                );
                projected.id = context.createId(
                    `${event.header.event_id}:${nativeUserId(user) || index}`,
                );
                return projected;
            });
        }
        case "im.chat.member.bot.added_v1":
            return [projectBotMembership(event, rawEvent, payload, context, true)];
        case "im.chat.member.bot.deleted_v1":
        case "im.chat.disbanded_v1":
            return [projectBotMembership(event, rawEvent, payload, context, false)];
        case "application.bot.menu_v6":
            return [projectMenuInteraction(event, rawEvent, payload, context)];
        case "im.chat.updated_v1":
        case "im.chat.member.user.withdrawn_v1":
            return [
                notice(event, rawEvent, context, "custom", {
                    group: groupValue(payload.chat_id, context),
                    ...extension(eventType),
                }),
            ];
        default:
            return [notice(event, rawEvent, context, "custom", extension(eventType))];
    }
}

function projectMessageReads(
    event: FeishuEvent,
    rawEvent: FeishuWebhookBody,
    payload: Record<string, unknown>,
    context: ProjectorContext,
): CommonEvent.Notice<FeishuWebhookBody>[] {
    const reader = objectValue(payload.reader);
    const messageIds = Array.isArray(payload.message_id_list)
        ? payload.message_id_list.filter(
              (value): value is string => typeof value === "string" && !!value,
          )
        : [];
    if (!messageIds.length) {
        return [notice(event, rawEvent, context, "custom", extension(event.header.event_type))];
    }
    return messageIds.map(messageId => {
        const projected = notice(event, rawEvent, context, "message_status", {
            message_id: context.createId(messageId),
            user: userValue(objectValue(reader.reader_id), context),
            extensions: {
                feishu: {
                    event_type: event.header.event_type,
                    status: "read",
                    read_time: stringValue(reader.read_time),
                    tenant_key: stringValue(reader.tenant_key),
                },
            },
        });
        projected.id = context.createId(`${event.header.event_id}:${messageId}`);
        return projected;
    });
}

function projectBotMembership(
    event: FeishuEvent,
    rawEvent: FeishuWebhookBody,
    payload: Record<string, unknown>,
    context: ProjectorContext,
    joined: boolean,
): CommonEvent.Notice<FeishuWebhookBody> {
    return notice(event, rawEvent, context, joined ? "group_increase" : "group_decrease", {
        user: { id: context.botId, name: "" },
        operator: userValue(objectValue(payload.operator_id), context),
        group: groupValue(payload.chat_id, context, payload.name),
        sub_type: event.header.event_type,
        extensions: {
            feishu: {
                event_type: event.header.event_type,
                external: payload.external === true,
                operator_tenant_key: stringValue(payload.operator_tenant_key),
            },
        },
    });
}

function projectMenuInteraction(
    event: FeishuEvent,
    rawEvent: FeishuWebhookBody,
    payload: Record<string, unknown>,
    context: ProjectorContext,
): CommonEvent.Notice<FeishuWebhookBody> {
    const operator = objectValue(payload.operator);
    const user = userValue(objectValue(operator.operator_id), context);
    return notice(event, rawEvent, context, "interaction", {
        user,
        operator: user,
        extensions: {
            feishu: {
                event_type: event.header.event_type,
                event_key: stringValue(payload.event_key),
                timestamp: typeof payload.timestamp === "number" ? payload.timestamp : undefined,
                operator_name: stringValue(operator.operator_name),
            },
        },
    });
}

function projectReaction(
    event: FeishuEvent,
    rawEvent: FeishuWebhookBody,
    payload: Record<string, unknown>,
    context: ProjectorContext,
): CommonEvent.Notice<FeishuWebhookBody> {
    const userId = objectValue(payload.user_id);
    const reaction = objectValue(payload.reaction_type);
    return notice(
        event,
        rawEvent,
        context,
        event.header.event_type.endsWith("created_v1") ? "reaction_added" : "reaction_removed",
        {
            message_id: idValue(payload.message_id, context),
            user: userValue(userId, context),
            extensions: {
                feishu: {
                    event_type: event.header.event_type,
                    emoji_type: stringValue(reaction.emoji_type),
                    operator_type: stringValue(payload.operator_type),
                    action_time: stringValue(payload.action_time),
                },
            },
        },
    );
}

function projectMessage(
    event: FeishuEvent,
    rawEvent: FeishuWebhookBody,
    payload: Record<string, unknown>,
    context: ProjectorContext,
): CommonEvent.Message<FeishuWebhookBody> | undefined {
    const message = objectValue(payload.message);
    const messageId = stringValue(message.message_id);
    if (!messageId) return undefined;
    const sender = objectValue(payload.sender);
    const senderId = objectValue(sender.sender_id);
    const legacySender = objectValue(message.sender);
    const userId = firstString(
        senderId.open_id,
        senderId.user_id,
        senderId.union_id,
        legacySender.id,
    );
    const chatId = stringValue(message.chat_id);
    const chatType = stringValue(message.chat_type);
    const isGroup = chatType === "group" || (chatType !== "p2p" && Boolean(chatId));
    return {
        ...base(event, rawEvent, context),
        id: context.createId(messageId),
        type: "message",
        message_type: isGroup ? "group" : "private",
        sender: { id: context.createId(userId), name: userId },
        group: isGroup ? { id: context.createId(chatId), name: "" } : undefined,
        message_id: context.createId(messageId),
        raw_message: stringValue(message.content, objectValue(message.body).content),
        message: projectFeishuMessageSegments(message),
    };
}

export function projectFeishuMessageSegments(
    message: Record<string, unknown>,
): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    const parentId = stringValue(message.parent_id);
    if (parentId) segments.push({ type: "reply", data: { message_id: parentId } });
    const messageType = firstString(message.message_type, message.msg_type, "text");
    const rawContent = stringValue(message.content, objectValue(message.body).content);
    const content = parseContent(rawContent);
    const mentions = Array.isArray(message.mentions) ? message.mentions.map(objectValue) : [];

    if (messageType === "text") {
        appendTextWithMentions(segments, stringValue(content.text, rawContent), mentions);
    } else if (messageType === "image") {
        segments.push({
            type: "image",
            data: { file: content.image_key, image_key: content.image_key },
        });
    } else if (["file", "audio", "media", "sticker"].includes(messageType)) {
        const type = messageType === "media" ? "video" : messageType;
        segments.push({
            type,
            data: {
                file: content.file_key,
                file_key: content.file_key,
                image_key: content.image_key,
                filename: content.file_name,
            },
        });
    } else {
        segments.push({ type: messageType, data: { content } });
    }
    return segments;
}

function appendTextWithMentions(
    segments: CommonTypes.Segment[],
    text: string,
    mentions: Record<string, unknown>[],
): void {
    let remaining = text;
    for (const mention of mentions) {
        const key = stringValue(mention.key);
        if (!key || !remaining.includes(key)) continue;
        const [before, ...after] = remaining.split(key);
        if (before) segments.push({ type: "text", data: { text: before } });
        const mentionId = objectValue(mention.id);
        segments.push({
            type: "at",
            data: {
                user_id: firstString(mentionId.open_id, mentionId.user_id, mention.id),
                name: stringValue(mention.name),
            },
        });
        remaining = after.join(key);
    }
    if (remaining) segments.push({ type: "text", data: { text: remaining } });
}

function notice(
    event: FeishuEvent,
    rawEvent: FeishuWebhookBody,
    context: ProjectorContext,
    noticeType: CommonEvent.NoticeType,
    fields: Omit<Partial<CommonEvent.Notice<FeishuWebhookBody>>, keyof CommonEvent.Base | "type">,
): CommonEvent.Notice<FeishuWebhookBody> {
    return {
        ...base(event, rawEvent, context),
        type: "notice",
        notice_type: noticeType,
        ...fields,
    };
}

function base(
    event: FeishuEvent,
    rawEvent: FeishuWebhookBody,
    context: ProjectorContext,
): CommonEvent.Base<FeishuWebhookBody> {
    return {
        id: context.createId(
            event.header.event_id || `${event.header.event_type}:sha256:${sha256Json(rawEvent)}`,
        ),
        timestamp: coerceUnixToEventMs(event.header.create_time),
        type: "custom",
        platform: "feishu",
        bot_id: context.botId,
        raw_event: rawEvent,
    };
}

function extension(eventType: string): { extensions: { feishu: { event_type: string } } } {
    return { extensions: { feishu: { event_type: eventType } } };
}

function groupValue(
    value: unknown,
    context: ProjectorContext,
    name: unknown = "",
): CommonTypes.Group | undefined {
    const id = stringValue(value);
    return id ? { id: context.createId(id), name: stringValue(name) } : undefined;
}

function userValue(
    value: Record<string, unknown>,
    context: ProjectorContext,
): CommonTypes.User | undefined {
    const id = nativeUserId(value);
    return id ? { id: context.createId(id), name: stringValue(value.name, id) } : undefined;
}

function nativeUserId(value: Record<string, unknown>): string {
    const nestedId = objectValue(value.user_id);
    return firstString(
        value.open_id,
        typeof value.user_id === "string" ? value.user_id : undefined,
        value.union_id,
        value.member_id,
        nestedId.open_id,
        nestedId.user_id,
        nestedId.union_id,
    );
}

function idValue(value: unknown, context: ProjectorContext): CommonTypes.Id | undefined {
    const id = stringValue(value);
    return id ? context.createId(id) : undefined;
}

function parseContent(raw: string): Record<string, unknown> {
    if (!raw) return {};
    try {
        return objectValue(JSON.parse(raw));
    } catch {
        return { text: raw };
    }
}

function objectValue(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback: unknown = ""): string {
    return typeof value === "string" && value
        ? value
        : typeof fallback === "string"
          ? fallback
          : "";
}

function firstString(...values: unknown[]): string {
    for (const value of values) if (typeof value === "string" && value) return value;
    return "";
}

function singleton<T>(value: T | undefined): T[] {
    return value === undefined ? [] : [value];
}
