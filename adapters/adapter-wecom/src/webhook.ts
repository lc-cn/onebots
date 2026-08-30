import { createHash } from "node:crypto";
import {
    decryptWechatCallbackFor,
    extractWechatEncryptedPayload,
    parseWechatXml,
    verifyWechatCallbackSignature,
} from "onebots";
import { WeComApiError } from "./errors.js";
import type { WeComConfig, WeComEvent, WeComWebhookRequest } from "./types.js";

/** 验证企业微信 URL，并返回解密后的 echostr。 */
export function verifyWeComEndpoint(
    config: WeComConfig,
    query: Readonly<Record<string, unknown>>,
): string | undefined {
    const credentials = requireCallbackCredentials(config);
    const timestamp = queryString(query, "timestamp");
    const nonce = queryString(query, "nonce");
    const echo = queryString(query, "echostr");
    if (
        !verifyWechatCallbackSignature(
            credentials.token,
            queryString(query, "msg_signature"),
            timestamp,
            nonce,
            echo,
        )
    ) {
        return undefined;
    }
    return decryptWechatCallbackFor(echo, credentials.encodingAesKey, config.corp_id);
}

/** 验签、解密并解析原始企业微信 POST 回调。 */
export function decodeWeComEvent(config: WeComConfig, request: WeComWebhookRequest): WeComEvent {
    const credentials = requireCallbackCredentials(config);
    const encryptedXml = bodyString(request.body);
    const encrypted = extractWechatEncryptedPayload(encryptedXml);
    if (!encrypted) {
        throw new WeComApiError("企业微信回调缺少 Encrypt", {
            code: "WECOM_INVALID_WEBHOOK_BODY",
            status: 400,
        });
    }
    if (
        !verifyWechatCallbackSignature(
            credentials.token,
            queryString(request.query, "msg_signature"),
            queryString(request.query, "timestamp"),
            queryString(request.query, "nonce"),
            encrypted,
        )
    ) {
        throw new WeComApiError("企业微信 Webhook 签名验证失败", {
            code: "WECOM_INVALID_SIGNATURE",
            status: 403,
        });
    }
    const xml = decryptWechatCallbackFor(encrypted, credentials.encodingAesKey, config.corp_id);
    const value = parseWechatXml(xml) as WeComEvent;
    if (typeof value.MsgType !== "string") {
        throw new WeComApiError("企业微信回调缺少 MsgType", {
            code: "WECOM_INVALID_WEBHOOK_BODY",
            status: 400,
        });
    }
    value.RawXml = xml;
    value.EncryptedXml = encryptedXml;
    return value;
}

export function weComEventId(event: WeComEvent): string {
    if (event.MsgId) return event.MsgId;
    const identity = [
        event.FromUserName,
        event.CreateTime,
        event.Event || event.MsgType,
        event.ChangeType,
        event.UserID,
        event.ExternalUserID,
        event.ChatId,
        event.EventKey,
    ]
        .filter(Boolean)
        .join(":");
    const digest = createHash("sha256")
        .update(event.RawXml || JSON.stringify(eventWithoutEncryptedXml(event)))
        .digest("hex");
    return identity ? `${identity}:${digest.slice(0, 16)}` : digest;
}

function eventWithoutEncryptedXml(event: WeComEvent): Record<string, unknown> {
    return Object.fromEntries(Object.entries(event).filter(([key]) => key !== "EncryptedXml"));
}

function requireCallbackCredentials(config: WeComConfig): {
    token: string;
    encodingAesKey: string;
} {
    if (!config.token || !config.encoding_aes_key) {
        throw new WeComApiError("企业微信原始回调需要 token 和 encoding_aes_key", {
            code: "WECOM_WEBHOOK_CONFIG_REQUIRED",
        });
    }
    return { token: config.token, encodingAesKey: config.encoding_aes_key };
}

function queryString(query: Readonly<Record<string, unknown>>, name: string): string {
    const value = query[name];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first !== "string" || !first) {
        throw new WeComApiError(`企业微信 Webhook 缺少 ${name}`, {
            code: "WECOM_INVALID_WEBHOOK_QUERY",
            status: 400,
        });
    }
    return first;
}

function bodyString(body: string | Buffer | undefined): string {
    if (typeof body === "string") return body;
    if (Buffer.isBuffer(body)) return body.toString("utf8");
    throw new WeComApiError("企业微信 Webhook 请求体为空", {
        code: "WECOM_INVALID_WEBHOOK_BODY",
        status: 400,
    });
}
