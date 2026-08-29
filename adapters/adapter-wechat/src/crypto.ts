import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
    timingSafeEqual,
} from "node:crypto";
import { WechatApiError } from "./errors.js";

/** 微信签名为 token、timestamp、nonce（及密文）排序后的 SHA-1。 */
export function verifyWechatSignature(
    token: string,
    signature: string,
    timestamp: string,
    nonce: string,
    encrypted?: string,
): boolean {
    if (!signature || !timestamp || !nonce) return false;
    const expected = signWechatMessage(token, timestamp, nonce, encrypted);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return (
        actualBuffer.length === expectedBuffer.length &&
        timingSafeEqual(actualBuffer, expectedBuffer)
    );
}

export function signWechatMessage(
    token: string,
    timestamp: string,
    nonce: string,
    encrypted?: string,
): string {
    const parts = encrypted ? [token, timestamp, nonce, encrypted] : [token, timestamp, nonce];
    return createHash("sha1").update(parts.sort().join(""), "utf8").digest("hex");
}

export function decryptWechatPayload(
    encrypted: string,
    encodingAesKey: string,
    expectedAppId: string,
): string {
    const key = decodeKey(encodingAesKey);
    let plain: Buffer;
    try {
        const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
        decipher.setAutoPadding(false);
        plain = removeWechatPadding(
            Buffer.concat([decipher.update(encrypted, "base64"), decipher.final()]),
        );
    } catch (error) {
        throw new WechatApiError("微信公众号消息解密失败", {
            code: "WECHAT_DECRYPT_ERROR",
            cause: error,
        });
    }
    if (plain.length < 20) return invalidPayload();
    const length = plain.readUInt32BE(16);
    const messageEnd = 20 + length;
    if (messageEnd > plain.length) return invalidPayload();
    const appId = plain.subarray(messageEnd).toString("utf8");
    if (appId !== expectedAppId) {
        throw new WechatApiError("微信公众号加密消息 AppID 不匹配", {
            code: "WECHAT_APP_ID_MISMATCH",
            details: appId,
        });
    }
    return plain.subarray(20, messageEnd).toString("utf8");
}

export function encryptWechatPayload(
    message: string,
    encodingAesKey: string,
    appId: string,
): string {
    const key = decodeKey(encodingAesKey);
    const body = Buffer.from(message, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(body.length);
    const plain = addWechatPadding(
        Buffer.concat([randomBytes(16), length, body, Buffer.from(appId, "utf8")]),
    );
    const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64");
}

function decodeKey(value: string): Buffer {
    if (!/^[A-Za-z\d+/]{43}$/u.test(value)) {
        throw new WechatApiError("encoding_aes_key 必须是 43 位 Base64 字符串", {
            code: "WECHAT_INVALID_AES_KEY",
        });
    }
    const key = Buffer.from(`${value}=`, "base64");
    if (key.length !== 32) {
        throw new WechatApiError("encoding_aes_key 解码后必须是 32 字节", {
            code: "WECHAT_INVALID_AES_KEY",
        });
    }
    return key;
}

function addWechatPadding(value: Buffer): Buffer {
    const remainder = value.length % 32;
    const amount = remainder === 0 ? 32 : 32 - remainder;
    return Buffer.concat([value, Buffer.alloc(amount, amount)]);
}

function removeWechatPadding(value: Buffer): Buffer {
    const amount = value.at(-1);
    if (!amount || amount < 1 || amount > 32 || amount > value.length) return invalidPayload();
    const padding = value.subarray(value.length - amount);
    if (!padding.every(byte => byte === amount)) return invalidPayload();
    return value.subarray(0, value.length - amount);
}

function invalidPayload(): never {
    throw new WechatApiError("微信公众号加密消息结构无效", {
        code: "WECHAT_INVALID_ENCRYPTED_PAYLOAD",
    });
}
