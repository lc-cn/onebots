import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SlackBot } from "./bot.js";

describe("SlackBot HTTP Events", () => {
    it("验证原始请求体签名后再接收事件", async () => {
        const secret = "test-secret";
        const timestamp = String(Math.floor(Date.now() / 1000));
        const rawBody =
            '{"type":"event_callback","event":{"type":"reaction_added","event_ts":"1"}}';
        const signature = `v0=${createHmac("sha256", secret)
            .update(`v0:${timestamp}:${rawBody}`)
            .digest("hex")}`;
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test", signing_secret: secret });
        const listener = vi.fn();
        bot.on("event", listener);
        const ctx = {
            request: { rawBody, body: JSON.parse(rawBody) },
            get: (name: string) => (name === "x-slack-request-timestamp" ? timestamp : signature),
            status: 200,
            body: undefined,
        };

        await bot.handleWebhook(ctx as never, vi.fn());

        expect(listener).toHaveBeenCalledOnce();
        expect(ctx.body).toEqual({ ok: true });
    });

    it("拒绝无效签名", async () => {
        const bot = new SlackBot({
            account_id: "A1",
            token: "xoxb-test",
            signing_secret: "secret",
        });
        const ctx = {
            request: { rawBody: "{}", body: {} },
            get: () => "invalid",
            status: 200,
            body: undefined,
        };

        await bot.handleWebhook(ctx as never, vi.fn());

        expect(ctx.status).toBe(401);
        expect(ctx.body).toEqual({ ok: false, error: "invalid_signature" });
    });
});

describe("SlackBot conversations", () => {
    it("创建频道并返回闭合的频道模型", async () => {
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test" });
        const create = vi.fn().mockResolvedValue({
            ok: true,
            channel: { id: "C1", name: "general", is_channel: true, is_private: false },
        });
        bot.getWebClient().conversations.create = create;

        await expect(bot.createChannel("general")).resolves.toEqual({
            id: "C1",
            name: "general",
            is_channel: true,
            is_private: false,
        });
        expect(create).toHaveBeenCalledWith({ name: "general" });
    });

    it("拒绝缺少频道信息的成功响应", async () => {
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test" });
        bot.getWebClient().conversations.create = vi.fn().mockResolvedValue({ ok: true });

        await expect(bot.createChannel("general")).rejects.toThrow("响应缺少频道信息");
    });

    it("通过 filesUploadV2 上传 Base64 文件并返回真实消息时间戳", async () => {
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test" });
        const upload = vi.fn().mockResolvedValue({
            ok: true,
            files: [{ files: [{ shares: { public: { C1: [{ ts: "171.0001" }] } } }] }],
        });
        bot.getWebClient().filesUploadV2 = upload;

        await expect(
            bot.sendFiles(
                "C1",
                [
                    {
                        source: "base64://aW1hZ2U=",
                        filename: "image.png",
                        altText: "截图",
                    },
                ],
                "说明",
                { thread_ts: "170.0001" },
            ),
        ).resolves.toMatchObject({ channel: "C1", ts: "171.0001" });
        expect(upload).toHaveBeenCalledWith(
            expect.objectContaining({
                channel_id: "C1",
                thread_ts: "170.0001",
                initial_comment: "说明",
                file_uploads: [
                    expect.objectContaining({
                        file: expect.any(Buffer),
                        filename: "image.png",
                        alt_text: "截图",
                    }),
                ],
            }),
        );
    });

    it("使用有界消息上下文保存线程父消息", () => {
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test" });
        bot.rememberMessage("171.0002", "C1", "170.0001");
        expect(bot.getMessageContext("171.0002")).toEqual({
            channel: "C1",
            threadTs: "170.0001",
        });
    });
});
