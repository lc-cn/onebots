import type { webhook } from "@line/bot-sdk";
import { CommonEvent, type CommonTypes } from "onebots";

interface LineProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

/** 将所有 LINE Webhook Event 投影到 CommonEvent；未知及管理事件仍以 custom 无损交付。 */
export function projectLineEvent(
    event: webhook.Event,
    context: LineProjectionContext,
): CommonEvent.Event<webhook.Event> | undefined {
    if (event.type === "message") return projectMessage(event, context);
    if (event.type === "messageEdited") {
        return notice(event, context, "message_updated", {
            message_id: context.createId(event.message.id),
            message: projectMessageContent(event.message),
            user: sourceUser(event.source, context),
            group: sourceGroup(event.source, context),
        });
    }
    if (event.type === "unsend") {
        return notice(event, context, "message_deleted", {
            message_id: context.createId(event.unsend.messageId),
            user: sourceUser(event.source, context),
            group: sourceGroup(event.source, context),
        });
    }
    if (event.type === "follow") {
        return notice(event, context, "friend_add", { user: sourceUser(event.source, context) });
    }
    if (event.type === "unfollow") {
        return notice(event, context, "user_removed", { user: sourceUser(event.source, context) });
    }
    if (event.type === "memberJoined" || event.type === "memberLeft") {
        const members = event.type === "memberJoined" ? event.joined.members : event.left.members;
        const first = members[0];
        return notice(
            event,
            context,
            event.type === "memberJoined" ? "member_joined" : "member_left",
            {
                user: first?.userId ? { id: context.createId(first.userId), name: "" } : undefined,
                group: sourceGroup(event.source, context),
                users: members.flatMap(member =>
                    member.userId ? [{ id: context.createId(member.userId), name: "" }] : [],
                ),
            },
        );
    }
    if (event.type === "postback") {
        return notice(event, context, "interaction", {
            user: sourceUser(event.source, context),
            group: sourceGroup(event.source, context),
            extensions: { line: { postback: event.postback, reply_token: event.replyToken } },
        });
    }
    return notice(event, context, "custom", {
        user: sourceUser(event.source, context),
        group: sourceGroup(event.source, context),
        extensions: { line: { kind: event.type, reply_token: replyToken(event) } },
    });
}

function projectMessage(
    event: webhook.MessageEvent,
    context: LineProjectionContext,
): CommonEvent.Message<webhook.Event> {
    return {
        ...base(event, context),
        type: "message",
        message_type: event.source?.type === "user" ? "private" : "group",
        sender: sourceUser(event.source, context) || {
            id: context.createId("unknown"),
            name: "",
        },
        group: sourceGroup(event.source, context),
        message_id: context.createId(event.message.id),
        message: projectMessageContent(event.message),
        raw_message: event.message.type === "text" ? event.message.text : "",
        extensions: {
            line: {
                reply_token: event.replyToken,
                quote_token: "quoteToken" in event.message ? event.message.quoteToken : undefined,
                is_redelivery: event.deliveryContext.isRedelivery,
            },
        },
    };
}

export function projectMessageContent(message: webhook.MessageContent): CommonTypes.Segment[] {
    const reply = "quotedMessageId" in message ? message.quotedMessageId : undefined;
    const segments: CommonTypes.Segment[] = reply
        ? [{ type: "reply", data: { message_id: reply } }]
        : [];
    if (message.type === "text") {
        segments.push(...projectTextSegments(message));
        return segments;
    }
    if (message.type === "image") {
        segments.push({
            type: "image",
            data: {
                file: message.id,
                url: message.contentProvider.originalContentUrl,
                preview: message.contentProvider.previewImageUrl,
            },
        });
    } else if (message.type === "video") {
        segments.push({ type: "video", data: { file: message.id, duration: message.duration } });
    } else if (message.type === "audio") {
        segments.push({ type: "audio", data: { file: message.id, duration: message.duration } });
    } else if (message.type === "file") {
        segments.push({
            type: "file",
            data: { file: message.id, name: message.fileName, size: message.fileSize },
        });
    } else if (message.type === "location") {
        segments.push({
            type: "location",
            data: {
                title: message.title,
                address: message.address,
                latitude: message.latitude,
                longitude: message.longitude,
            },
        });
    } else if (message.type === "sticker") {
        segments.push({
            type: "sticker",
            data: {
                id: `${message.packageId}:${message.stickerId}`,
                package_id: message.packageId,
                sticker_id: message.stickerId,
                resource_type: message.stickerResourceType,
                keywords: message.keywords,
                text: message.text,
            },
        });
    }
    return segments;
}

function projectTextSegments(message: webhook.TextMessageContent): CommonTypes.Segment[] {
    const mentions = [...(message.mention?.mentionees || [])].sort(
        (left, right) => left.index - right.index,
    );
    if (!mentions.length) return [{ type: "text", data: { text: message.text } }];
    const segments: CommonTypes.Segment[] = [];
    let cursor = 0;
    for (const mention of mentions) {
        if (mention.index < cursor || mention.index > message.text.length) continue;
        if (mention.index > cursor) {
            segments.push({
                type: "text",
                data: { text: message.text.slice(cursor, mention.index) },
            });
        }
        const display = message.text.slice(mention.index, mention.index + mention.length);
        segments.push({
            type: "at",
            data: {
                user_id:
                    mention.type === "all"
                        ? "all"
                        : mention.userId || (mention.isSelf ? "self" : undefined),
                text: display,
                is_self: mention.type === "user" ? mention.isSelf : undefined,
            },
        });
        cursor = mention.index + mention.length;
    }
    if (cursor < message.text.length) {
        segments.push({ type: "text", data: { text: message.text.slice(cursor) } });
    }
    return segments;
}

function notice(
    event: webhook.Event,
    context: LineProjectionContext,
    noticeType: CommonEvent.NoticeType,
    fields: Omit<Partial<CommonEvent.Notice<webhook.Event>>, keyof CommonEvent.Base | "type">,
): CommonEvent.Notice<webhook.Event> {
    return { ...base(event, context), type: "notice", notice_type: noticeType, ...fields };
}

function base(
    event: webhook.Event,
    context: LineProjectionContext,
): CommonEvent.Base<webhook.Event> {
    return {
        id: context.createId(event.webhookEventId),
        timestamp: event.timestamp,
        platform: "line",
        bot_id: context.botId,
        type: "custom",
        raw_event: event,
    };
}

function sourceUser(
    source: webhook.Source | undefined,
    context: LineProjectionContext,
): CommonTypes.User | undefined {
    const userId = source && "userId" in source ? source.userId : undefined;
    return userId ? { id: context.createId(userId), name: "" } : undefined;
}

function sourceGroup(
    source: webhook.Source | undefined,
    context: LineProjectionContext,
): CommonTypes.Group | undefined {
    if (!source || source.type === "user") return undefined;
    const id = source.type === "group" ? source.groupId : source.roomId;
    return { id: context.createId(id), name: source.type === "room" ? "LINE Room" : "" };
}

function replyToken(event: webhook.Event): string | undefined {
    return "replyToken" in event && typeof event.replyToken === "string"
        ? event.replyToken
        : undefined;
}
