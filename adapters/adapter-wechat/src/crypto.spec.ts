import { describe, expect, it } from "vitest";
import {
    decryptWechatPayload,
    encryptWechatPayload,
    signWechatMessage,
    verifyWechatSignature,
} from "./crypto.js";

const key = Buffer.alloc(32, 7).toString("base64").slice(0, 43);

describe("微信公众号消息密码学", () => {
    it("按微信格式加解密并校验 AppID", () => {
        const encrypted = encryptWechatPayload("<xml>ok</xml>", key, "wx-app");
        expect(decryptWechatPayload(encrypted, key, "wx-app")).toBe("<xml>ok</xml>");
        expect(() => decryptWechatPayload(encrypted, key, "other-app")).toThrowError(
            expect.objectContaining({ code: "WECHAT_APP_ID_MISMATCH" }),
        );
    });

    it("签名与参数顺序无关并以常量时间比较", () => {
        const signature = signWechatMessage("token", "1", "2", "cipher");
        expect(verifyWechatSignature("token", signature, "1", "2", "cipher")).toBe(true);
        expect(verifyWechatSignature("token", `${signature}0`, "1", "2", "cipher")).toBe(false);
    });
});
