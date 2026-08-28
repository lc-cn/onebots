import { coerceUnixToEventMs, type CommonEvent, type CommonTypes } from "onebots";
import type { WeComEvent } from "./types.js";

export interface WeComProjectionContext {
    botId: string;
    createId(value: string | number): CommonTypes.Id;
}

/** 将企业微信原生回调无副作用地投影成 CommonEvent。 */
export function projectWeComEvent(
    event: WeComEvent,
    context: WeComProjectionContext,
): CommonEvent.Event<WeComEvent> {
    const eventType = event.EventType ?? event.Event;
    const timestamp = coerceUnixToEventMs(event.CreateTime ?? event.TimeStamp);
    const eventId =
        event.MsgId ??
        event.EventId ??
        `${event.FromUserName ?? "unknown"}:${eventType ?? event.MsgType ?? "event"}:${timestamp}`;
    const base = {
        id: context.createId(eventId),
        timestamp,
        platform: "wecom",
        bot_id: context.createId(context.botId),
        raw_event: event,
    };

    if (event.MsgType && event.MsgType !== "event") {
        return {
            ...base,
            type: "message",
            message_type: "private",
            sender: {
                id: context.createId(event.FromUserName ?? ""),
                name: event.FromUserName,
            },
            message_id: context.createId(eventId),
            raw_message: event.Content ?? event.Label ?? event.Title ?? "",
            message: projectWeComSegments(event),
        };
    }

    if (eventType === "change_contact") {
        const noticeType = contactNoticeTypes[event.ChangeType ?? ""];
        return {
            ...base,
            type: "notice",
            notice_type: noticeType ?? "custom",
            user: event.UserID ? { id: context.createId(event.UserID) } : undefined,
            extensions: noticeType
                ? undefined
                : { wecom: { event_type: eventType, change_type: event.ChangeType } },
        };
    }

    return {
        ...base,
        type: "notice",
        notice_type: "custom",
        user: event.FromUserName ? { id: context.createId(event.FromUserName) } : undefined,
        extensions: {
            wecom: {
                event_type: eventType,
                change_type: event.ChangeType,
            },
        },
    };
}

export function projectWeComSegments(event: WeComEvent): CommonTypes.Segment[] {
    switch (event.MsgType) {
        case "text":
            return [{ type: "text", data: { text: event.Content ?? "" } }];
        case "image":
            return [{ type: "image", data: { file_id: event.MediaId, url: event.PicUrl } }];
        case "voice":
            return [
                {
                    type: "audio",
                    data: {
                        file_id: event.MediaId,
                        format: event.Format,
                        recognition: event.Recognition,
                    },
                },
            ];
        case "video":
            return [{ type: "video", data: { file_id: event.MediaId } }];
        case "location":
            return [
                {
                    type: "location",
                    data: {
                        latitude: event.Location_X,
                        longitude: event.Location_Y,
                        scale: event.Scale,
                        label: event.Label,
                    },
                },
            ];
        case "link":
            return [
                {
                    type: "link",
                    data: {
                        title: event.Title,
                        description: event.Description,
                        url: event.Url,
                    },
                },
            ];
        default:
            return [{ type: event.MsgType ?? "unknown", data: {} }];
    }
}

const contactNoticeTypes: Record<string, CommonEvent.NoticeType> = {
    create_user: "user_added",
    update_user: "user_updated",
    delete_user: "user_removed",
};
