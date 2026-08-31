import { CommonEvent, type CommonTypes } from "onebots";
import { wechatEventId } from "./client.js";
import type { WechatIncomingMessage } from "./types.js";

export interface WechatProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

/** 将微信消息或事件投影为 CommonEvent，同时无损保留 raw_event。 */
export function projectWechatEvent(
    message: WechatIncomingMessage,
    context: WechatProjectionContext,
): CommonEvent.Event<WechatIncomingMessage> {
    return message.MsgType === "event"
        ? projectNotice(message, context)
        : projectMessage(message, context);
}

function projectMessage(
    message: WechatIncomingMessage,
    context: WechatProjectionContext,
): CommonEvent.Message<WechatIncomingMessage> {
    const id = wechatEventId(message);
    const segments = projectSegments(message);
    return {
        ...base(id, message, context),
        type: "message",
        message_type: "private",
        sender: { id: context.createId(message.FromUserName), name: message.FromUserName },
        message_id: context.createId(id),
        raw_message: message.Content || message.MediaId || message.Title || "",
        message: segments,
        extensions: {
            wechat: {
                msg_type: message.MsgType,
                msg_data_id: message.MsgDataId,
                index: message.Idx,
                recognition: message.Recognition,
            },
        },
    };
}

function projectNotice(
    message: WechatIncomingMessage,
    context: WechatProjectionContext,
): CommonEvent.Notice<WechatIncomingMessage> {
    const event = (message.Event || "unknown").toLowerCase();
    const messageId = message.MsgID || message.MsgId;
    return {
        ...base(wechatEventId(message), message, context),
        type: "notice",
        notice_type: noticeType(event),
        sub_type: event,
        ...(messageId ? { message_id: context.createId(messageId) } : {}),
        user: { id: context.createId(message.FromUserName), name: message.FromUserName },
        extensions: {
            wechat: {
                event,
                event_key: message.EventKey,
                ticket: message.Ticket,
                latitude: message.Latitude,
                longitude: message.Longitude,
                precision: message.Precision,
                status: message.Status,
                error_code: message.ErrorCode,
                total_count: message.TotalCount,
                filter_count: message.FilterCount,
                sent_count: message.SentCount,
                error_count: message.ErrorCount,
                copyright_check_result: message.CopyrightCheckResult,
            },
        },
    };
}

function noticeType(event: string): CommonEvent.NoticeType {
    if (event === "subscribe") return "friend_add";
    if (event === "unsubscribe") return "friend_remove";
    if (event === "templatesendjobfinish" || event === "masssendjobfinish") {
        return "message_status";
    }
    if (
        event === "scan" ||
        [
            "click",
            "view",
            "scancode_push",
            "scancode_waitmsg",
            "pic_sysphoto",
            "pic_photo_or_album",
            "pic_weixin",
            "location_select",
            "view_miniprogram",
        ].includes(event)
    ) {
        return "interaction";
    }
    return "custom";
}

function projectSegments(message: WechatIncomingMessage): CommonTypes.Segment[] {
    switch (message.MsgType) {
        case "text":
            return [{ type: "text", data: { text: message.Content || "" } }];
        case "image":
            return [mediaSegment("image", message.MediaId, message.PicUrl)];
        case "voice":
            return [
                mediaSegment("voice", message.MediaId, undefined, {
                    format: message.Format,
                    recognition: message.Recognition,
                }),
            ];
        case "video":
        case "shortvideo":
            return [
                mediaSegment("video", message.MediaId, undefined, {
                    thumb_media_id: message.ThumbMediaId,
                    short: message.MsgType === "shortvideo",
                }),
            ];
        case "location":
            return [
                {
                    type: "location",
                    data: {
                        latitude: message.Location_X,
                        longitude: message.Location_Y,
                        scale: message.Scale,
                        label: message.Label,
                    },
                },
            ];
        case "link":
            return [
                {
                    type: "link",
                    data: {
                        title: message.Title,
                        description: message.Description,
                        url: message.Url,
                    },
                },
            ];
        default:
            return [{ type: "wechat_message", data: { message: structuredClone(message) } }];
    }
}

function mediaSegment(
    type: string,
    mediaId?: string,
    url?: string,
    extra: Record<string, unknown> = {},
): CommonTypes.Segment {
    return {
        type,
        data: { file: mediaId, media_id: mediaId, url, ...extra },
    };
}

function base(
    id: string,
    message: WechatIncomingMessage,
    context: WechatProjectionContext,
): CommonEvent.Base<WechatIncomingMessage> {
    return {
        id: context.createId(id),
        timestamp: message.CreateTime * 1000,
        platform: "wechat",
        bot_id: context.botId,
        type: "custom",
        raw_event: message,
    };
}
