import { describe, expect, it, vi } from "vitest";
import { WechatClient } from "./client.js";
import { encryptWechatPayload, signWechatMessage } from "./crypto.js";
import type { WechatConfig } from "./types.js";
import { WechatWebhookHost } from "./webhook-host.js";

const key = Buffer.alloc(32, 9).toString("base64").slice(0, 43);
const config: WechatConfig = {
    account_id: "bot",
    app_id: "wx-app",
    app_secret: "secret",
    token: "token",
    encoding_aes_key: key,
    passive_reply_timeout_ms: 0,
};
const xml = `<xml><ToUserName><![CDATA[bot]]></ToUserName><FromUserName><![CDATA[user]]></FromUserName><CreateTime>123</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hello]]></Content><MsgId>9</MsgId></xml>`;

describe("WechatWebhookHost", () => {
    it("完成明文服务器验证", async () => {
        const host = new WechatWebhookHost(config, new WechatClient(config));
        const timestamp = "1";
        const nonce = "2";
        await expect(
            host.ingest({
                method: "GET",
                query: {
                    timestamp,
                    nonce,
                    echostr: "echo",
                    signature: signWechatMessage("token", timestamp, nonce),
                },
            }),
        ).resolves.toMatchObject({ status: 200, body: "echo" });
    });

    it("验证明文消息、分发一次并过滤重投递", async () => {
        const client = new WechatClient(config);
        const listener = vi.fn();
        client.on("raw_event", listener);
        const host = new WechatWebhookHost(config, client);
        const query = {
            timestamp: "1",
            nonce: "2",
            signature: signWechatMessage("token", "1", "2"),
        };
        await expect(host.ingest({ method: "POST", query, body: xml })).resolves.toMatchObject({
            status: 200,
            body: "success",
        });
        await host.ingest({ method: "POST", query, body: xml });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("解密安全模式消息并校验密文签名", async () => {
        const client = new WechatClient(config);
        const listener = vi.fn();
        client.on("raw_event", listener);
        const host = new WechatWebhookHost(config, client);
        const encrypted = encryptWechatPayload(xml, key, "wx-app");
        const body = `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`;
        await expect(
            host.ingest({
                method: "POST",
                query: {
                    encrypt_type: "aes",
                    timestamp: "1",
                    nonce: "2",
                    msg_signature: signWechatMessage("token", "1", "2", encrypted),
                },
                body,
            }),
        ).resolves.toMatchObject({ status: 200, body: "success" });
        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({ RawXml: xml, EncryptedXml: body }),
        );
    });

    it("HTTP 接入明确拒绝其他方法", async () => {
        const host = new WechatWebhookHost(config, new WechatClient(config));
        const ctx = {
            method: "PUT",
            request: {},
            query: {},
            status: 0,
            body: undefined as unknown,
            type: "",
        };
        await host.acceptHttp(ctx);
        expect(ctx).toMatchObject({
            status: 405,
            body: { error: { code: "WECHAT_METHOD_NOT_ALLOWED" } },
        });
    });
});
