import { sha256Json, sha256Text } from "onebots";
import { WechatApiError } from "./errors.js";
import type { WechatIncomingMessage } from "./types.js";

/** 在进入去重管线前闭合公众号事件的稳定身份字段。 */
export function assertWechatIncomingMessage(message: WechatIncomingMessage): void {
    if (
        typeof message.ToUserName !== "string" ||
        !message.ToUserName ||
        typeof message.FromUserName !== "string" ||
        !message.FromUserName ||
        !Number.isFinite(message.CreateTime) ||
        message.CreateTime <= 0 ||
        typeof message.MsgType !== "string" ||
        !message.MsgType
    ) {
        throw new WechatApiError("微信公众号事件缺少稳定的收发方、时间或消息类型", {
            code: "WECHAT_INVALID_EVENT",
        });
    }
    if (message.MsgType !== "event" && (!message.MsgId || typeof message.MsgId !== "string")) {
        throw new WechatApiError("微信公众号消息缺少 MsgId", {
            code: "WECHAT_INVALID_EVENT",
        });
    }
}

/** 优先使用平台消息 ID，否则将可读上下文与规范化载荷摘要组合为确定性身份。 */
export function wechatEventId(message: WechatIncomingMessage): string {
    if (message.MsgId || message.MsgID) return message.MsgId || message.MsgID!;
    const identity = [
        message.FromUserName,
        message.CreateTime,
        message.Event || message.MsgType,
        message.EventKey,
    ]
        .filter(value => value !== undefined && value !== "")
        .join(":");
    const digest = message.RawXml
        ? sha256Text(message.RawXml)
        : sha256Json(messageWithoutEncryptedXml(message));
    return identity ? `${identity}:${digest.slice(0, 16)}` : digest;
}

function messageWithoutEncryptedXml(message: WechatIncomingMessage): Record<string, unknown> {
    return Object.fromEntries(Object.entries(message).filter(([key]) => key !== "EncryptedXml"));
}
