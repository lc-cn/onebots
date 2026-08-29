import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WeComClient } from "./client.js";
import type { WeComConfig } from "./types.js";
import { WeComWebhookHost } from "./webhook-host.js";

const aesKey = Buffer.alloc(32, 6);
const config: WeComConfig = {
    account_id: "bot",
    corp_id: "ww-corp",
    corp_secret: "secret",
    agent_id: "1000001",
    token: "token",
    encoding_aes_key: aesKey.toString("base64").slice(0, 43),
};

describe("WeComWebhookHost", () => {
    it("验证并解密 URL 校验密文", async () => {
        const host = new WeComWebhookHost(config, new WeComClient(config));
        const echo = encrypt("verified");
        await expect(
            host.ingest({
                method: "GET",
                query: { timestamp: "1", nonce: "2", echostr: echo, msg_signature: sign(echo) },
            }),
        ).resolves.toMatchObject({ status: 200, body: "verified" });
    });

    it("只接受验签后的加密事件，并过滤重复投递", async () => {
        const client = new WeComClient(config);
        const listener = vi.fn();
        client.on("raw_event", listener);
        const host = new WeComWebhookHost(config, client);
        const xml = `<xml><ToUserName><![CDATA[ww-corp]]></ToUserName><FromUserName><![CDATA[u1]]></FromUserName><CreateTime>1</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hi]]></Content><MsgId>m1</MsgId></xml>`;
        const encrypted = encrypt(xml);
        const body = `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`;
        const request = {
            method: "POST" as const,
            query: { timestamp: "1", nonce: "2", msg_signature: sign(encrypted) },
            body,
        };
        await expect(host.ingest(request)).resolves.toMatchObject({ status: 200, body: "success" });
        await host.ingest(request);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({ RawXml: xml, EncryptedXml: body }),
        );
    });

    it("拒绝明文回调和不支持的 HTTP 方法", async () => {
        const host = new WeComWebhookHost(config, new WeComClient(config));
        await expect(
            host.ingest({ method: "POST", query: {}, body: "<xml></xml>" }),
        ).rejects.toMatchObject({ code: "WECOM_INVALID_WEBHOOK_BODY" });
        const ctx = {
            method: "PUT",
            request: {},
            query: {},
            status: 0,
            body: undefined as unknown,
            type: "",
        };
        await host.acceptHttp(ctx);
        expect(ctx.status).toBe(405);
    });

    it("对错误签名返回 403 且不分发事件", async () => {
        const client = new WeComClient(config);
        const listener = vi.fn();
        client.on("raw_event", listener);
        const host = new WeComWebhookHost(config, client);
        const encrypted = encrypt(
            `<xml><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[enter_agent]]></Event></xml>`,
        );
        await expect(
            host.ingest({
                method: "POST",
                query: { timestamp: "1", nonce: "2", msg_signature: "invalid" },
                body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
            }),
        ).resolves.toMatchObject({ status: 403 });
        expect(listener).not.toHaveBeenCalled();
    });
});

function sign(encrypted: string): string {
    return createHash("sha1")
        .update([config.token, "1", "2", encrypted].sort().join(""))
        .digest("hex");
}

function encrypt(xml: string): string {
    const message = Buffer.from(xml);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(message.length);
    const source = Buffer.concat([
        Buffer.alloc(16, 1),
        length,
        message,
        Buffer.from(config.corp_id),
    ]);
    const amount = source.length % 32 === 0 ? 32 : 32 - (source.length % 32);
    const plain = Buffer.concat([source, Buffer.alloc(amount, amount)]);
    const cipher = createCipheriv("aes-256-cbc", aesKey, aesKey.subarray(0, 16));
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64");
}
