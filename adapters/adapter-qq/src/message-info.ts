import { type Adapter, type CommonTypes } from "onebots";
import { QQApiError } from "./errors.js";
import type { QQGuildMessage } from "./open-api.js";

type CreateId = (value: string | number) => CommonTypes.Id;

/** 在 OpenAPI 边界校验消息详情，并投影为通用消息模型。 */
export function toQQMessageInfo(
    scene: "channel" | "direct",
    sceneId: CommonTypes.Id,
    message: QQGuildMessage,
    createId: CreateId,
): Adapter.MessageInfo {
    const timestamp = typeof message.timestamp === "string" ? Date.parse(message.timestamp) : NaN;
    if (!message.id || !Number.isFinite(timestamp) || !message.author?.id) {
        throw invalidMessage(message, "QQ 消息详情缺少有效的 id、timestamp 或 author.id");
    }
    const attachments = (message.attachments ?? []).map(attachment => {
        if (!attachment || typeof attachment.url !== "string" || !attachment.url) {
            throw invalidMessage(message, "QQ 消息详情包含无效附件");
        }
        return {
            type: attachment.content_type?.startsWith("image/") ? "image" : "file",
            data: { url: attachment.url, name: attachment.filename },
        } satisfies CommonTypes.Segment;
    });
    return {
        message_id: createId(message.id),
        time: timestamp,
        sender: {
            scene_type: scene,
            sender_id: createId(message.author.id),
            scene_id: sceneId,
            sender_name: message.author.username ?? "",
            scene_name: "",
        },
        message: [
            ...(message.content ? [{ type: "text", data: { text: message.content } }] : []),
            ...attachments,
        ],
    };
}

function invalidMessage(message: QQGuildMessage, reason: string): QQApiError {
    return new QQApiError(reason, {
        code: "QQ_INVALID_MESSAGE_RESPONSE",
        details: { message_id: message.id },
    });
}
