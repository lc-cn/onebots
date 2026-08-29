import { DiscordError } from "../errors.js";
import type { DiscordInteractionHttpResponse } from "./interactions.js";

export const DISCORD_INTERACTION_JSON_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
} as const;

/** 使用 Web Crypto 校验 Discord Ed25519 请求签名。 */
export async function verifyInteractionSignature(
    publicKey: string,
    signature: string,
    timestamp: string,
    body: string,
): Promise<boolean> {
    try {
        if (!/^[\da-f]{64}$/i.test(publicKey) || !/^[\da-f]{128}$/i.test(signature)) return false;
        const cryptoKey = await crypto.subtle.importKey(
            "raw",
            hexToUint8Array(publicKey),
            { name: "Ed25519", namedCurve: "Ed25519" },
            false,
            ["verify"],
        );
        return crypto.subtle.verify(
            "Ed25519",
            cryptoKey,
            hexToUint8Array(signature),
            new TextEncoder().encode(timestamp + body),
        );
    } catch {
        // 外部签名或公钥格式无效属于正常鉴权失败，由调用方统一返回 401。
        return false;
    }
}

export function isInteractionTimestampFresh(timestamp: string, maxAgeMs: number): boolean {
    if (!/^\d+$/.test(timestamp)) return false;
    if (maxAgeMs === 0) return true;
    const timestampMs = Number(timestamp) * 1000;
    return Number.isSafeInteger(timestampMs) && Math.abs(Date.now() - timestampMs) <= maxAgeMs;
}

export function interactionHttpError(
    status: number,
    error: string,
    message?: string,
): DiscordInteractionHttpResponse {
    return {
        status,
        headers:
            status === 405
                ? { ...DISCORD_INTERACTION_JSON_HEADERS, Allow: "POST" }
                : DISCORD_INTERACTION_JSON_HEADERS,
        body: { error, ...(message ? { message } : {}) },
    };
}

export function interactionFetchResponse(response: DiscordInteractionHttpResponse): Response {
    return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: response.headers,
    });
}

export function parseInteractionJson(body: string): unknown {
    try {
        return JSON.parse(body) as unknown;
    } catch {
        throw DiscordError.invalid(
            "Discord Interaction 请求体不是有效 JSON",
            "DISCORD_INTERACTION_INVALID_JSON",
        );
    }
}

function hexToUint8Array(hex: string): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
    for (let index = 0; index < bytes.length; index++) {
        bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}
