/**
 * 企业微信回调加解密与验签（与公众号算法一致，参见官方「接收消息」文档）
 */
import { createHash, createDecipheriv } from "node:crypto";

export function verifyWeComSignature(
    token: string,
    msgSignature: string,
    timestamp: string,
    nonce: string,
    encrypt: string,
): boolean {
    const arr = [token, timestamp, nonce, encrypt].sort();
    const sha1 = createHash("sha1").update(arr.join("")).digest("hex");
    return sha1 === msgSignature;
}

/**
 * 解密企业微信 AES 消息体，返回明文 XML（内部业务包）
 */
export function decryptWeComPayload(encryptedBase64: string, encodingAESKey: string): string {
    if (!encodingAESKey) {
        throw new Error("未配置 encoding_aes_key，无法解密消息");
    }
    try {
        const key = Buffer.from(encodingAESKey + "=", "base64");
        const iv = key.slice(0, 16);
        const decipher = createDecipheriv("aes-256-cbc", key, iv);
        decipher.setAutoPadding(false);
        let decrypted = Buffer.concat([decipher.update(encryptedBase64, "base64"), decipher.final()]);
        const pad = decrypted[decrypted.length - 1];
        decrypted = decrypted.slice(0, decrypted.length - pad);
        const content = decrypted.slice(16);
        const msgLength = content.readUInt32BE(0);
        return content.slice(4, msgLength + 4).toString("utf-8");
    } catch (e) {
        const err = e as Error;
        throw new Error(`解密消息失败: ${err.message}`);
    }
}

/**
 * 可选：解密后校验尾部 receiveid 是否为企业 CorpID
 */
export function decryptWeComPayloadWithReceiveId(
    encryptedBase64: string,
    encodingAESKey: string,
    expectReceiveId: string,
): string {
    if (!encodingAESKey) {
        throw new Error("未配置 encoding_aes_key，无法解密消息");
    }
    const key = Buffer.from(encodingAESKey + "=", "base64");
    const iv = key.slice(0, 16);
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(encryptedBase64, "base64"), decipher.final()]);
    const pad = decrypted[decrypted.length - 1];
    decrypted = decrypted.slice(0, decrypted.length - pad);
    const content = decrypted.slice(16);
    const msgLength = content.readUInt32BE(0);
    const xml = content.slice(4, msgLength + 4).toString("utf-8");
    const receiveId = content.slice(4 + msgLength).toString("utf-8");
    if (expectReceiveId && receiveId && receiveId !== expectReceiveId) {
        throw new Error("解密后的 receiveid 与企业 corp_id 不一致");
    }
    return xml;
}

/** 从 XML 提取 Encrypt CDATA */
export function extractEncryptFromXml(xml: string): string | null {
    const m = xml.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
    return m ? m[1] : null;
}

/** 简易 XML 解析（CDATA 或纯数字子节点） */
export function parseSimpleXml(xml: string): Record<string, string | number> {
    const message: Record<string, string | number> = {};
    const re = /<(\w+)>(?:<!\[CDATA\[(.*?)\]\]>|([^<]+))<\/\1>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml)) !== null) {
        const [, key, cdata, plain] = match;
        if (cdata !== undefined && cdata !== "") {
            message[key] = cdata;
        } else if (plain !== undefined && plain !== undefined) {
            const t = plain.trim();
            message[key] = /^\d+$/.test(t) ? parseInt(t, 10) : t;
        }
    }
    return message;
}
