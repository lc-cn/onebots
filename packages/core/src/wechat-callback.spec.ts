import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    decryptWechatCallbackFor,
    parseWechatXml,
    verifyWechatCallbackSignature,
} from "./wechat-callback.js";

describe("wechat callback utilities", () => {
    it("解析 CDATA、数字与 XML 实体", () => {
        const parsed = parseWechatXml(
            "<xml><MsgType><![CDATA[text]]></MsgType><CreateTime>123</CreateTime><Content>a &amp; b</Content></xml>",
        );
        expect(parsed).toEqual({ MsgType: "text", CreateTime: 123, Content: "a & b" });
    });

    it("保留超出 JavaScript 安全整数范围的消息 ID", () => {
        const parsed = parseWechatXml("<xml><MsgId>9223372036854775807</MsgId></xml>");
        expect(parsed.MsgId).toBe("9223372036854775807");
    });

    it("使用恒定时间比较验证签名", () => {
        const values = ["token", "123", "nonce", "cipher"].sort().join("");
        const signature = createHash("sha1").update(values).digest("hex");
        expect(verifyWechatCallbackSignature("token", signature, "123", "nonce", "cipher")).toBe(
            true,
        );
        expect(verifyWechatCallbackSignature("token", "bad", "123", "nonce", "cipher")).toBe(false);
    });

    it("解密并校验 receive id", () => {
        const aesKey = Buffer.alloc(32, 7);
        const encodedKey = aesKey.toString("base64").slice(0, -1);
        const xml = "<xml><MsgType><![CDATA[text]]></MsgType></xml>";
        const receiveId = "ww-test";
        const random = Buffer.alloc(16, 1);
        const message = Buffer.from(xml);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(message.length);
        const plain = addPkcs7Padding(
            Buffer.concat([random, length, message, Buffer.from(receiveId)]),
        );
        const cipher = createCipheriv("aes-256-cbc", aesKey, aesKey.subarray(0, 16));
        cipher.setAutoPadding(false);
        const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64");

        expect(decryptWechatCallbackFor(encrypted, encodedKey, receiveId)).toBe(xml);
        expect(() => decryptWechatCallbackFor(encrypted, encodedKey, "wrong")).toThrow("receiveid");
    });
});

function addPkcs7Padding(buffer: Buffer): Buffer {
    const padding = 32 - (buffer.length % 32 || 32) || 32;
    return Buffer.concat([buffer, Buffer.alloc(padding, padding)]);
}
