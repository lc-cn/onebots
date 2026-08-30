import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WeComKfClient } from "./client.js";
import type { WeComKfConfig } from "./types.js";
import { WeComKfWebhookHost } from "./webhook-host.js";

const aesKey = Buffer.alloc(32, 7);
const config: WeComKfConfig = {
    account_id: "kf",
    corp_id: "ww-corp",
    corp_secret: "secret",
    token: "token",
    encoding_aes_key: aesKey.toString("base64").slice(0, 43),
};

describe("WeComKfWebhookHost", () => {
    it("验证并解密 URL 校验密文", async () => {
        const host = new WeComKfWebhookHost(config, new WeComKfClient(config));
        const echo = encrypt("verified");
        await expect(
            host.ingest({
                method: "GET",
                query: { timestamp: "1", nonce: "2", echostr: echo, msg_signature: sign(echo) },
            }),
        ).resolves.toMatchObject({ status: 200, body: "verified" });
    });

    it("只接受验签后的密文并用回调 token 同步对应客服账号", async () => {
        const client = new WeComKfClient(config);
        const synchronize = vi.spyOn(client, "synchronize").mockResolvedValue([]);
        const callback = vi.fn();
        client.on("callback", callback);
        const host = new WeComKfWebhookHost(config, client);
        const xml = `<xml><ToUserName><![CDATA[ww-corp]]></ToUserName><CreateTime>1</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[pull-token]]></Token><OpenKfId><![CDATA[wk-1]]></OpenKfId></xml>`;
        const encrypted = encrypt(xml);
        const body = `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`;
        await expect(
            host.ingest({
                method: "POST",
                query: { timestamp: "1", nonce: "2", msg_signature: sign(encrypted) },
                body,
            }),
        ).resolves.toMatchObject({ status: 200, body: "success" });
        expect(synchronize).toHaveBeenCalledWith("wk-1", "pull-token");
        expect(callback).toHaveBeenCalledWith(
            expect.objectContaining({ RawXml: xml, EncryptedXml: body }),
        );
    });

    it("字段校验后立即确认回调并异步报告同步错误", async () => {
        const client = new WeComKfClient(config);
        let rejectSynchronization: (error: Error) => void = () => undefined;
        vi.spyOn(client, "synchronize").mockReturnValue(
            new Promise((_resolve, reject) => {
                rejectSynchronization = reject;
            }),
        );
        const callback = vi.fn();
        const onError = vi.fn();
        client.on("callback", callback);
        const host = new WeComKfWebhookHost(config, client, onError);
        const xml = `<xml><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[pull-token]]></Token><OpenKfId><![CDATA[wk-1]]></OpenKfId></xml>`;
        const encrypted = encrypt(xml);

        await expect(
            host.ingest({
                method: "POST",
                query: { timestamp: "1", nonce: "2", msg_signature: sign(encrypted) },
                body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
            }),
        ).resolves.toMatchObject({ status: 200, body: "success" });
        expect(callback).toHaveBeenCalledTimes(1);

        rejectSynchronization(new Error("sync failed"));
        await vi.waitFor(() =>
            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({ code: "WECOM_KF_SYNC_ERROR" }),
            ),
        );
    });

    it("不会投影缺少同步凭证的 kf_msg_or_event", async () => {
        const client = new WeComKfClient(config);
        const callback = vi.fn();
        client.on("callback", callback);
        const host = new WeComKfWebhookHost(config, client);
        const xml = `<xml><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[kf_msg_or_event]]></Event></xml>`;
        const encrypted = encrypt(xml);

        await expect(
            host.ingest({
                method: "POST",
                query: { timestamp: "1", nonce: "2", msg_signature: sign(encrypted) },
                body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
            }),
        ).rejects.toMatchObject({ code: "WECOM_KF_INVALID_CALLBACK" });
        expect(callback).not.toHaveBeenCalled();
    });

    it("业务监听器异常时拒绝确认 Webhook 以允许平台重投", async () => {
        const client = new WeComKfClient(config);
        const delivered = vi.fn();
        client.on("callback", () => {
            throw new Error("listener failed");
        });
        client.on("callback", delivered);
        const host = new WeComKfWebhookHost(config, client);
        const xml = `<xml><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[account_updated]]></Event></xml>`;
        const encrypted = encrypt(xml);

        await expect(
            host.ingest({
                method: "POST",
                query: { timestamp: "1", nonce: "2", msg_signature: sign(encrypted) },
                body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
            }),
        ).rejects.toMatchObject({ code: "WECOM_KF_CALLBACK_DISPATCH_ERROR" });
        expect(delivered).toHaveBeenCalledOnce();
    });

    it("acceptHttp 接收标准 Request 并返回同一结构化结果", async () => {
        const client = new WeComKfClient(config);
        const callback = vi.fn();
        client.on("callback", callback);
        const host = new WeComKfWebhookHost(config, client);
        const xml = `<xml><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[account_updated]]></Event></xml>`;
        const encrypted = encrypt(xml);
        const query = new URLSearchParams({
            timestamp: "1",
            nonce: "2",
            msg_signature: sign(encrypted),
        });

        const response = await host.acceptHttp(
            new Request(`https://example.test/wecom-kf?${query}`, {
                method: "POST",
                body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe("success");
        expect(callback).toHaveBeenCalledOnce();
        const rejected = await host.acceptHttp(
            new Request("https://example.test/wecom-kf", { method: "PUT" }),
        );
        expect(rejected.status).toBe(405);
        expect(rejected.headers.get("allow")).toBe("GET, POST");
    });

    it("拒绝明文与错误签名", async () => {
        const host = new WeComKfWebhookHost(config, new WeComKfClient(config));
        await expect(
            host.ingest({ method: "POST", query: {}, body: "<xml></xml>" }),
        ).rejects.toMatchObject({ code: "WECOM_KF_INVALID_WEBHOOK_BODY" });
        const encrypted = encrypt(
            `<xml><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[unknown]]></Event></xml>`,
        );
        await expect(
            host.ingest({
                method: "POST",
                query: { timestamp: "1", nonce: "2", msg_signature: "invalid" },
                body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
            }),
        ).resolves.toMatchObject({ status: 403 });
    });

    it("将无效密文转换为结构化回调错误", async () => {
        const host = new WeComKfWebhookHost(config, new WeComKfClient(config));
        const encrypted = Buffer.from("invalid-ciphertext").toString("base64");

        await expect(
            host.ingest({
                method: "POST",
                query: { timestamp: "1", nonce: "2", msg_signature: sign(encrypted) },
                body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
            }),
        ).rejects.toMatchObject({
            code: "WECOM_KF_INVALID_ENCRYPTED_PAYLOAD",
            status: 400,
        });
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
