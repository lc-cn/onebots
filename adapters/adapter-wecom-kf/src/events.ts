import { createHash } from "node:crypto";
import { unixSecondsToEventMs, type CommonEvent, type CommonTypes } from "onebots";
import { resolveKfOpenKfId } from "./identity.js";
import type { KfCallbackEvent, KfMsgItem } from "./types.js";

export interface KfProjectionContext {
    botId: string;
    openKfId: string;
    createId(value: string | number): CommonTypes.Id;
}

/** 将 sync_msg 条目无损投影为统一事件，未知类型不会被丢弃。 */
export function projectKfItem(
    item: KfMsgItem,
    context: KfProjectionContext,
): CommonEvent.Event<KfMsgItem> {
    const itemOpenKfId = resolveKfOpenKfId(item, context.openKfId);
    const messageId = item.msgid || stableId(item);
    const timestamp = unixSecondsToEventMs(item.send_time ?? 0);
    const base = {
        id: context.createId(messageId),
        timestamp,
        platform: "wecom-kf",
        bot_id: context.createId(itemOpenKfId || context.botId),
        raw_event: item,
    };
    if (item.msgtype === "event") {
        const event = item.event || {};
        const eventType = stringValue(event.event_type) || "unknown";
        const openKfId = itemOpenKfId;
        const externalUserId = stringValue(event.external_userid) || item.external_userid;
        return {
            ...base,
            type: "notice",
            notice_type: "custom",
            sub_type: eventType,
            user: externalUserId ? { id: context.createId(externalUserId) } : undefined,
            extensions: {
                wecom_kf: {
                    event_type: eventType,
                    open_kfid: openKfId,
                    external_userid: externalUserId,
                    servicer_userid: stringValue(event.servicer_userid) || item.servicer_userid,
                    event: { ...event },
                },
            },
        };
    }
    const senderId =
        item.origin === 5
            ? item.servicer_userid || "servicer"
            : item.origin === 3
              ? item.external_userid || "customer"
              : `origin:${item.origin ?? "unknown"}`;
    const message = projectKfSegments(item);
    return {
        ...base,
        type: "message",
        message_type: "private",
        message_id: context.createId(messageId),
        sender: { id: context.createId(senderId), name: senderId },
        message,
        raw_message: item.msgtype === "text" ? item.text?.content || "" : "",
        extensions: {
            wecom_kf: {
                origin: item.origin,
                open_kfid: itemOpenKfId,
                external_userid: item.external_userid,
                servicer_userid: item.servicer_userid,
            },
        },
    };
}

/** 将回调本身投影为 notice；具体消息仍由 sync_msg 条目产生。 */
export function projectKfCallback(
    event: KfCallbackEvent,
    context: Omit<KfProjectionContext, "openKfId">,
): CommonEvent.Event<KfCallbackEvent> {
    const rawEvent = publicCallback(event);
    const identity = event.EncryptedXml || JSON.stringify(rawEvent);
    return {
        id: context.createId(createHash("sha256").update(identity).digest("hex")),
        timestamp: unixSecondsToEventMs(event.CreateTime ?? 0),
        platform: "wecom-kf",
        bot_id: context.createId(event.OpenKfId || context.botId),
        type: "notice",
        notice_type: "custom",
        sub_type: event.Event,
        raw_event: rawEvent,
        extensions: {
            wecom_kf: {
                callback: true,
                open_kfid: event.OpenKfId,
            },
        },
    };
}

/** 同步 Token 与明密文只用于接入层，绝不能沿协议事件发送给下游。 */
function publicCallback(event: KfCallbackEvent): KfCallbackEvent {
    const value: KfCallbackEvent = { ...event };
    delete value.Token;
    delete value.RawXml;
    delete value.EncryptedXml;
    return value;
}

export function projectKfSegments(item: KfMsgItem): CommonTypes.Segment[] {
    switch (item.msgtype) {
        case "text":
            return [
                {
                    type: "text",
                    data: { text: item.text?.content || "", menu_id: item.text?.menu_id },
                },
            ];
        case "image":
            return [{ type: "image", data: { file_id: item.image?.media_id } }];
        case "voice":
            return [{ type: "audio", data: { file_id: item.voice?.media_id } }];
        case "video":
            return [{ type: "video", data: { file_id: item.video?.media_id } }];
        case "file":
            return [{ type: "file", data: { file_id: item.file?.media_id } }];
        case "link":
            return [{ type: "link", data: { ...(item.link || {}) } }];
        case "location":
            return [{ type: "location", data: { ...(item.location || {}) } }];
        case "business_card":
            return [{ type: "contact", data: { ...(item.business_card || {}) } }];
        case "miniprogram":
            return [{ type: "miniprogram", data: { ...(item.miniprogram || {}) } }];
        case "msgmenu":
            return [{ type: "msgmenu", data: { ...(item.msgmenu || {}) } }];
        default:
            return [{ type: "wecom_kf_message", data: { item } }];
    }
}

function stableId(item: KfMsgItem): string {
    return createHash("sha256").update(JSON.stringify(item)).digest("hex");
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}
