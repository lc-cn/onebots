import type { CommonEvent, CommonTypes } from "onebots";
import type { IlinkBotMessage } from "./sdk/ilink-types.js";
import { ItemKind } from "./sdk/protocol/wire-models.js";
import { GatewayFault } from "./sdk/internal/errors.js";

export interface WechatClawbotProjectionContext {
    accountId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

/**
 * 无损投影 iLink 复合消息。媒体段保留下载所需的原生句柄，不伪造不可访问的 URL。
 */
export function projectWechatClawbotEvent(
    event: IlinkBotMessage,
    context: WechatClawbotProjectionContext,
): CommonEvent.Message<IlinkBotMessage["raw"]> {
    const stableId = event.id ?? event.seq;
    if (stableId === undefined) {
        throw new GatewayFault("INVALID_EVENT", "iLink 消息缺少稳定标识");
    }
    if (!event.from.id.trim()) {
        throw new GatewayFault("INVALID_EVENT", "iLink 消息缺少发送者");
    }
    const messageId = String(stableId);
    return {
        id: context.createId(messageId),
        timestamp: ilinkTimeToMs(event.date),
        platform: "wechat-clawbot",
        bot_id: context.accountId,
        type: "message",
        message_type: event.chat.type,
        sender: { id: context.createId(event.from.id), name: event.from.id },
        group:
            event.chat.type === "group"
                ? { id: context.createId(event.chat.id), name: event.chat.id }
                : undefined,
        message_id: context.createId(messageId),
        raw_message: event.raw.item_list
            ?.map(item => item.text_item?.text ?? item.voice_item?.text ?? "")
            .filter(Boolean)
            .join(""),
        message: projectSegments(event),
        raw_event: event.raw,
        extensions: {
            wechat_clawbot: {
                context_token: event.contextToken,
                session_id: event.raw.session_id,
                sequence: event.seq,
                message_type: event.raw.message_type,
                message_state: event.raw.message_state,
                update_time_ms: event.raw.update_time_ms,
                delete_time_ms: event.raw.delete_time_ms,
                run_id: event.raw.run_id,
            },
        },
    };
}

export function projectSegments(event: IlinkBotMessage): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    const projectedReferences = new Set<string>();
    for (const item of event.raw.item_list ?? []) {
        const reference = item.ref_msg;
        if (reference) {
            const referenceId = reference.message_item?.msg_id;
            if (!referenceId || !projectedReferences.has(referenceId)) {
                if (referenceId) projectedReferences.add(referenceId);
                segments.push(
                    referenceId
                        ? {
                              type: "reply",
                              data: {
                                  id: referenceId,
                                  message_id: referenceId,
                                  title: reference.title,
                              },
                          }
                        : { type: "wechat_clawbot_reference", data: { reference } },
                );
            }
        }
        if (item.type === ItemKind.Text && item.text_item?.text) {
            segments.push({ type: "text", data: { text: item.text_item.text } });
        } else if (item.type === ItemKind.Image && item.image_item?.media) {
            segments.push({ type: "image", data: nativeMedia(item.image_item.media) });
        } else if (item.type === ItemKind.Video && item.video_item?.media) {
            segments.push({
                type: "video",
                data: {
                    ...nativeMedia(item.video_item.media),
                    duration: item.video_item.play_length,
                },
            });
        } else if (item.type === ItemKind.File && item.file_item?.media) {
            segments.push({
                type: "file",
                data: {
                    ...nativeMedia(item.file_item.media),
                    name: item.file_item.file_name,
                    size: item.file_item.len,
                    md5: item.file_item.md5,
                },
            });
        } else if (item.type === ItemKind.Voice && item.voice_item?.media) {
            if (item.voice_item.text) {
                segments.push({ type: "text", data: { text: item.voice_item.text } });
            }
            segments.push({
                type: "audio",
                data: {
                    ...nativeMedia(item.voice_item.media),
                    codec: item.voice_item.encode_type,
                    duration: item.voice_item.playtime,
                    sample_rate: item.voice_item.sample_rate,
                },
            });
        } else if (item.type === ItemKind.ToolCallStart && item.tool_call_start_item) {
            segments.push({
                type: "wechat_clawbot_tool_call_start",
                data: { ...item.tool_call_start_item },
            });
        } else if (item.type === ItemKind.ToolCallResult && item.tool_call_result_item) {
            segments.push({
                type: "wechat_clawbot_tool_call_result",
                data: { ...item.tool_call_result_item },
            });
        } else {
            segments.push({ type: "wechat_clawbot_raw", data: { item } });
        }
    }
    return segments.length > 0
        ? segments
        : [{ type: "wechat_clawbot_raw", data: { item_list: [] } }];
}

function nativeMedia(media: {
    encrypt_query_param?: string;
    full_url?: string;
    aes_key?: string;
    encrypt_type?: number;
}): Record<string, unknown> {
    return {
        file_id: media.encrypt_query_param,
        url: media.full_url,
        aes_key: media.aes_key,
        encrypt_type: media.encrypt_type,
    };
}

function ilinkTimeToMs(value?: number): number {
    if (value == null || !Number.isFinite(value)) return Date.now();
    return value >= 1_000_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
}
