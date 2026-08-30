import { createHash, randomUUID } from "node:crypto";
import { ValidationError } from "./errors.js";

export interface WechatJsApiSignatureOptions {
    ticket: string;
    /** 浏览器当前完整 URL；签名会保留原始编码并仅移除 fragment。 */
    url: string;
    nonceStr?: string;
    timestamp?: number;
}

export interface WechatJsApiSignature {
    timestamp: number;
    nonceStr: string;
    signature: string;
}

/**
 * 生成微信公众号与企业微信共用的 JS-SDK 签名。
 *
 * URL 解析只用于安全校验，签名仍使用调用方提供的原始字符串，避免 WHATWG URL
 * 规范化百分号编码后与浏览器实际地址不一致。
 */
export function createWechatJsApiSignature(
    options: WechatJsApiSignatureOptions,
): WechatJsApiSignature {
    if (typeof options.ticket !== "string" || !options.ticket.trim()) {
        throw new ValidationError("JS-SDK ticket 不能为空");
    }
    const pageUrl = validateWebUrl(options.url);
    const nonceStr = options.nonceStr || randomUUID();
    if (typeof nonceStr !== "string" || !nonceStr.trim()) {
        throw new ValidationError("JS-SDK nonceStr 不能为空");
    }
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(timestamp) || timestamp < 1) {
        throw new ValidationError("JS-SDK timestamp 必须是正安全整数");
    }
    const source = [
        `jsapi_ticket=${options.ticket}`,
        `noncestr=${nonceStr}`,
        `timestamp=${timestamp}`,
        `url=${stripFragment(pageUrl)}`,
    ].join("&");
    return {
        timestamp,
        nonceStr,
        signature: createHash("sha1").update(source).digest("hex"),
    };
}

function validateWebUrl(value: string): string {
    if (typeof value !== "string" || !value || value !== value.trim() || !URL.canParse(value)) {
        throw new ValidationError("JS-SDK url 必须是有效 URL");
    }
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
        throw new ValidationError("JS-SDK url 必须是无凭据的 HTTP(S) URL");
    }
    return value;
}

function stripFragment(value: string): string {
    const index = value.indexOf("#");
    return index === -1 ? value : value.slice(0, index);
}
