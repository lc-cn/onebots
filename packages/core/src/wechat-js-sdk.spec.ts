import { describe, expect, it } from "vitest";
import { createWechatJsApiSignature } from "./wechat-js-sdk.js";

describe("createWechatJsApiSignature", () => {
    it("保留原始 URL 编码、移除 fragment 并按微信固定顺序签名", () => {
        expect(
            createWechatJsApiSignature({
                ticket: "ticket-1",
                url: "https://example.com/%7Epage?x=1#client-route",
                nonceStr: "nonce",
                timestamp: 1_700_000_000,
            }),
        ).toEqual({
            timestamp: 1_700_000_000,
            nonceStr: "nonce",
            signature: "8f3f7c1734dbe082b71f1590c8bcccbc2e0f0fe7",
        });
    });

    it("拒绝危险 URL 与非法时间戳", () => {
        expect(() =>
            createWechatJsApiSignature({
                ticket: "ticket",
                url: "https://user:password@example.com/page",
            }),
        ).toThrow("无凭据");
        expect(() =>
            createWechatJsApiSignature({
                ticket: "ticket",
                url: "https://example.com/page",
                timestamp: 0,
            }),
        ).toThrow("正安全整数");
    });
});
