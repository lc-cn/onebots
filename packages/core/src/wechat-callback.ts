/**
 * 微信生态回调的通用 XML、签名与 AES 解密实现。
 *
 * 公众号、企业微信应用和微信客服使用相同的基础算法。集中在 core 可以避免
 * 各 Adapter 分别维护安全敏感实现，修复一次即可覆盖所有调用方。
 */
import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

export function verifyWechatCallbackSignature(
    token: string,
    signature: string,
    timestamp: string,
    nonce: string,
    encrypted = "",
): boolean {
    const expected = createHash("sha1")
        .update([token, timestamp, nonce, encrypted].filter(Boolean).sort().join(""))
        .digest("hex");
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return (
        actualBuffer.length === expectedBuffer.length &&
        timingSafeEqual(actualBuffer, expectedBuffer)
    );
}

export interface DecryptedWechatCallback {
    xml: string;
    receiveId: string;
}

export function decryptWechatCallback(
    encryptedBase64: string,
    encodingAesKey: string,
): DecryptedWechatCallback {
    if (!encodingAesKey) {
        throw new Error("未配置 encoding_aes_key，无法解密消息");
    }

    try {
        const key = Buffer.from(`${encodingAesKey}=`, "base64");
        if (key.length !== 32) {
            throw new Error("encoding_aes_key 长度无效");
        }

        const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
        decipher.setAutoPadding(false);
        const decrypted = Buffer.concat([
            decipher.update(encryptedBase64, "base64"),
            decipher.final(),
        ]);
        const unpadded = removePkcs7Padding(decrypted);
        const content = unpadded.subarray(16);
        if (content.length < 4) {
            throw new Error("解密消息长度无效");
        }

        const messageLength = content.readUInt32BE(0);
        const messageEnd = 4 + messageLength;
        if (messageEnd > content.length) {
            throw new Error("解密消息声明长度超出载荷");
        }

        return {
            xml: content.subarray(4, messageEnd).toString("utf8"),
            receiveId: content.subarray(messageEnd).toString("utf8"),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`解密消息失败: ${message}`, { cause: error });
    }
}

export function decryptWechatCallbackFor(
    encryptedBase64: string,
    encodingAesKey: string,
    expectedReceiveId: string,
): string {
    const result = decryptWechatCallback(encryptedBase64, encodingAesKey);
    if (expectedReceiveId && result.receiveId && result.receiveId !== expectedReceiveId) {
        throw new Error("解密后的 receiveid 与配置不一致");
    }
    return result.xml;
}

export function extractWechatEncryptedPayload(xml: string): string | undefined {
    const parsed = parseWechatXml(xml);
    const value = parsed.Encrypt;
    return typeof value === "string" ? value : undefined;
}

/** 解析微信回调的一层标量 XML；不执行实体展开，避免 XML 外部实体风险。 */
export function parseWechatXml(xml: string): Record<string, string | number> {
    const result: Record<string, string | number> = {};
    const elementPattern = /<(\w+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
    let match: RegExpExecArray | null;
    while ((match = elementPattern.exec(xml)) !== null) {
        const [, key, cdata, plain] = match;
        const value = cdata ?? plain?.trim() ?? "";
        const numeric = /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
        // 微信 MsgId 等字段可能是 64 位整数；超出安全范围时必须保留字符串，避免 ID 静默失真。
        result[key] = Number.isSafeInteger(numeric) ? numeric : decodeXmlEntities(value);
    }
    return result;
}

function removePkcs7Padding(buffer: Buffer): Buffer {
    if (buffer.length === 0) {
        throw new Error("解密消息为空");
    }
    const padding = buffer[buffer.length - 1];
    if (padding < 1 || padding > 32 || padding > buffer.length) {
        throw new Error("PKCS#7 padding 无效");
    }
    for (let index = buffer.length - padding; index < buffer.length; index += 1) {
        if (buffer[index] !== padding) {
            throw new Error("PKCS#7 padding 无效");
        }
    }
    return buffer.subarray(0, buffer.length - padding);
}

function decodeXmlEntities(value: string): string {
    return value
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
}
