/**
 * sync_msg 消息条目 -> CommonEvent
 */
import type { Adapter, CommonEvent, CommonTypes } from "onebots";
import { unixSecondsToEventMs } from "onebots";
import type { KfMsgItem } from "./types.js";

function segmentsFromItem(item: KfMsgItem): CommonTypes.Segment[] {
    const segs: CommonTypes.Segment[] = [];
    const mt = item.msgtype;
    if (mt === "text" && item.text?.content) {
        segs.push({ type: "text", data: { text: item.text.content } });
    } else if (mt === "image" && item.image?.media_id) {
        segs.push({ type: "image", data: { file_id: item.image.media_id } });
    } else if (mt === "voice" && item.voice?.media_id) {
        segs.push({ type: "record", data: { file_id: item.voice.media_id } });
    } else if (mt === "video" && item.video?.media_id) {
        segs.push({ type: "video", data: { file_id: item.video.media_id } });
    } else if (mt === "file" && item.file?.media_id) {
        segs.push({ type: "file", data: { file_id: item.file.media_id } });
    } else if (mt === "link" && item.link) {
        segs.push({
            type: "text",
            data: {
                text: `${item.link.title || ""} ${item.link.url || ""}`.trim() || "[link]",
            },
        });
    } else if (mt === "location" && item.location) {
        segs.push({
            type: "text",
            data: {
                text: `[位置] ${item.location.name || ""} ${item.location.address || ""}`,
            },
        });
    } else if (mt === "miniprogram" && item.miniprogram) {
        segs.push({
            type: "text",
            data: {
                text: `[小程序] ${item.miniprogram.title || ""} ${item.miniprogram.pagepath || ""}`,
            },
        });
    } else if (mt && mt !== "event") {
        segs.push({ type: "text", data: { text: `[${mt}]` } });
    }
    return segs;
}

export function kfItemToCommonEvent(
    item: KfMsgItem,
    ctx: {
        createId: Adapter["createId"];
        platform: string;
        botAccountId: string;
        openKfId: string;
    },
): CommonEvent.Event | null {
    const msgId = String(item.msgid || `${Date.now()}-${Math.random()}`);
    const ts = unixSecondsToEventMs(item.send_time ?? 0);
    const botId = ctx.createId(ctx.botAccountId);

    if (item.msgtype === "event") {
        const ev = (item.event || {}) as Record<string, unknown>;
        const notice = {
            type: "notice" as const,
            id: ctx.createId(`${msgId}_evt`),
            timestamp: ts,
            platform: ctx.platform,
            bot_id: botId,
            notice_type: "custom" as const,
            sub_type: String(ev.event_type || ""),
            open_kfid: ev.open_kfid,
            external_userid: ev.external_userid,
            kf_event: ev,
            raw_event: item,
        };
        return notice as CommonEvent.Event;
    }

    /** 仅将微信客户消息作为 message 上报；接待人员消息可扩展 */
    if (item.origin !== 3 && item.origin !== 5) {
        return null;
    }

    const extUid = item.external_userid;
    if (!extUid) return null;

    const segs = segmentsFromItem(item);
    if (segs.length === 0) return null;

    const sender: CommonTypes.User = {
        id: ctx.createId(extUid),
        name:
            item.origin === 5
                ? String(item.servicer_userid || "servicer")
                : extUid,
    };

    const rawText = segs
        .filter((s) => s.type === "text")
        .map((s) => s.data.text)
        .join("");

    const msg = {
        type: "message" as const,
        id: ctx.createId(msgId),
        timestamp: ts,
        platform: ctx.platform,
        bot_id: botId,
        message_type: "private" as const,
        message_id: ctx.createId(msgId),
        sender,
        message: segs,
        raw_message: rawText || undefined,
        open_kfid: item.open_kfid || ctx.openKfId,
        kf_origin: item.origin,
        raw_message_object: item,
    };
    return msg as CommonEvent.Message;
}
