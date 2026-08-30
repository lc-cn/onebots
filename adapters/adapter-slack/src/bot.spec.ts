import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ErrorCategory } from "onebots";
import { SlackBot } from "./bot.js";
import { SlackError } from "./errors.js";

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
            set: vi.fn(),
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
        expect(ctx.body).toEqual({ ok: false, error: "SLACK_INVALID_SIGNATURE" });
    });

    it("Webhook 未配置签名密钥时明确拒绝接收", async () => {
        const bot = new SlackBot({
            account_id: "A1",
            token: "xoxb-test",
            receive_mode: "webhook",
        });
        const clientError = vi.fn();
        bot.on("client_error", clientError);
        const ctx = {
            request: { rawBody: "{}", body: {} },
            get: () => "",
            status: 200,
            body: undefined,
        };

        await bot.handleWebhook(ctx as never, vi.fn());

        expect(ctx.status).toBe(503);
        expect(ctx.body).toEqual({ ok: false, error: "SLACK_SIGNING_SECRET_REQUIRED" });
        expect(clientError).toHaveBeenCalledWith(
            expect.objectContaining({ code: "SLACK_SIGNING_SECRET_REQUIRED" }),
        );
    });

    it("接收交互表单 payload 并汇入公开 ingest 管线", async () => {
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test" });
        const event = vi.fn();
        const rawEvent = vi.fn();
        bot.on("event", event);
        bot.on("raw_event", rawEvent);

        const body = await bot.ingest({
            payload: JSON.stringify({ type: "block_actions", user: { id: "U1" } }),
        });

        expect(body).toMatchObject({ type: "block_actions", user: { id: "U1" } });
        expect(rawEvent).toHaveBeenCalledWith(body);
        expect(event).toHaveBeenCalledWith(
            expect.objectContaining({ type: "block_actions" }),
            body,
        );
    });

    it("拒绝无法投影的非对象载荷", async () => {
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test" });
        await expect(bot.ingest([])).rejects.toEqual(
            expect.objectContaining({ code: "SLACK_EVENT_INVALID" }),
        );
    });

    it("保留 Slack 重试的原始事件但只投影一次", async () => {
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test" });
        const event = vi.fn();
        const rawEvent = vi.fn();
        bot.on("event", event);
        bot.on("raw_event", rawEvent);
        const body = {
            type: "event_callback",
            event_id: "Ev-repeat",
            event: { type: "reaction_added", event_ts: "1" },
        };

        await bot.ingest(body);
        await bot.ingest(body);

        expect(rawEvent).toHaveBeenCalledTimes(2);
        expect(event).toHaveBeenCalledOnce();
    });

    it("业务监听器失败时不提交去重状态，允许 Slack 重投递", async () => {
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test" });
        const body = {
            type: "event_callback",
            event_id: "Ev-retry",
            event: { type: "reaction_added", event_ts: "1" },
        };
        const failure = (): void => {
            throw new Error("downstream failed");
        };
        bot.on("event", failure);
        await expect(bot.ingest(body)).rejects.toThrow("downstream failed");
        bot.off("event", failure);
        const listener = vi.fn();
        bot.on("event", listener);

        await bot.ingest(body);

        expect(listener).toHaveBeenCalledOnce();
    });

    it("等待异步业务监听器成功后才提交事件", async () => {
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test" });
        const body = {
            type: "event_callback",
            event_id: "Ev-async",
            event: { type: "reaction_added", event_ts: "1" },
        };
        let complete: (() => void) | undefined;
        const listener = vi.fn(() => new Promise<void>(resolve => (complete = resolve)));
        bot.on("event", listener);

        const first = bot.ingest(body);
        const concurrentRetry = bot.ingest(body);
        await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
        let settled = false;
        void first.then(() => (settled = true));
        await Promise.resolve();
        expect(settled).toBe(false);

        complete?.();
        await Promise.all([first, concurrentRetry]);
        await bot.ingest(body);
        expect(listener).toHaveBeenCalledOnce();
    });

    it("acceptHttp 验签并解析 Slash Command 表单", async () => {
        const secret = "test-secret";
        const timestamp = String(Math.floor(Date.now() / 1000));
        const rawBody = "command=%2Fhello&user_id=U1&channel_id=C1";
        const signature = `v0=${createHmac("sha256", secret)
            .update(`v0:${timestamp}:${rawBody}`)
            .digest("hex")}`;
        const bot = new SlackBot({
            account_id: "A1",
            token: "xoxb-test",
            signing_secret: secret,
        });
        const listener = vi.fn();
        bot.on("event", listener);

        const response = await bot.acceptHttp(
            new Request("https://example.test/slack", {
                method: "POST",
                body: rawBody,
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                    "x-slack-request-timestamp": timestamp,
                    "x-slack-signature": signature,
                },
            }),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
        expect(await response.json()).toEqual({ ok: true });
        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({ type: "slash_command", user_id: "U1" }),
            expect.objectContaining({ command: "/hello" }),
        );
        expect((await bot.acceptHttp(new Request("https://example.test/slack"))).status).toBe(405);
    });

    it("acceptHttp 将已验签但损坏的载荷稳定映射为 400", async () => {
        const secret = "test-secret";
        const timestamp = String(Math.floor(Date.now() / 1000));
        const rawBody = "not-json";
        const signature = `v0=${createHmac("sha256", secret)
            .update(`v0:${timestamp}:${rawBody}`)
            .digest("hex")}`;
        const bot = new SlackBot({
            account_id: "A1",
            token: "xoxb-test",
            signing_secret: secret,
        });

        const response = await bot.acceptHttp(
            new Request("https://example.test/slack", {
                method: "POST",
                body: rawBody,
                headers: {
                    "x-slack-request-timestamp": timestamp,
                    "x-slack-signature": signature,
                },
            }),
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            ok: false,
            error: "SLACK_WEBHOOK_INVALID",
        });
    });
});

describe("SlackBot lifecycle", () => {
    it("并发启动只鉴权一次且重复停止不重复发事件", async () => {
        const bot = new SlackBot({
            account_id: "A1",
            token: "xoxb-test",
            receive_mode: "webhook",
            signing_secret: "secret",
        });
        const auth = vi.fn().mockResolvedValue({ ok: true, user_id: "B1", user: "bot" });
        bot.getWebClient().auth.test = auth;
        const ready = vi.fn();
        const stopped = vi.fn();
        bot.on("ready", ready);
        bot.on("stopped", stopped);

        await Promise.all([bot.start(), bot.start()]);
        await bot.start();
        await bot.stop();
        await bot.stop();

        expect(auth).toHaveBeenCalledOnce();
        expect(ready).toHaveBeenCalledOnce();
        expect(stopped).toHaveBeenCalledOnce();
    });

    it("Socket 停止失败时仍通知 stopped 并向账号生命周期传播", async () => {
        const bot = new SlackBot({
            account_id: "A1",
            token: "xoxb-test",
            receive_mode: "socket",
            app_token: "xapp-test",
        });
        const disconnect = vi.fn().mockRejectedValue(new Error("disconnect failed"));
        const stopped = vi.fn();
        const clientError = vi.fn();
        bot.on("stopped", stopped);
        bot.on("client_error", clientError);
        (
            bot as unknown as {
                socketClient: { disconnect(): Promise<void> };
            }
        ).socketClient = { disconnect };

        await expect(bot.stop()).rejects.toThrow("disconnect failed");
        expect(disconnect).toHaveBeenCalledOnce();
        expect(stopped).toHaveBeenCalledOnce();
        expect(clientError).toHaveBeenCalledWith(
            expect.objectContaining({ code: "SLACK_SOCKET_STOP_FAILED" }),
        );
    });

    it("启动失败抛出结构化错误而不是静默离线", async () => {
        const bot = new SlackBot({
            account_id: "A1",
            token: "xoxb-test",
            receive_mode: "webhook",
            signing_secret: "secret",
        });
        bot.getWebClient().auth.test = vi.fn().mockRejectedValue(new Error("network down"));
        const clientError = vi.fn();
        bot.on("client_error", clientError);

        await expect(bot.start()).rejects.toMatchObject({
            code: "SLACK_API_ERROR",
            operation: "auth.test",
        });
        expect(clientError).toHaveBeenCalledOnce();
    });

    it("拒绝把缺少真实 Bot ID 的鉴权响应带入事件模型", async () => {
        const bot = new SlackBot({
            account_id: "A1",
            token: "xoxb-test",
            receive_mode: "webhook",
            signing_secret: "secret",
        });
        bot.getWebClient().auth.test = vi.fn().mockResolvedValue({ ok: true, user: "bot" });

        await expect(bot.start()).rejects.toMatchObject({
            code: "SLACK_BOT_ID_MISSING",
            category: ErrorCategory.PROTOCOL,
        });
        expect(bot.getCachedMe()).toBeNull();
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

        await expect(bot.createChannel("general")).rejects.toMatchObject({
            code: "SLACK_CHANNEL_MISSING",
            category: ErrorCategory.PROTOCOL,
        });
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

    it("将 Slack 平台业务错误收敛为结构化错误", async () => {
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test" });
        bot.getWebClient().apiCall = vi.fn().mockResolvedValue({
            ok: false,
            error: "channel_not_found",
        });

        const error = await bot
            .call("conversations.info", { channel: "missing" })
            .catch(value => value);
        expect(error).toBeInstanceOf(SlackError);
        expect(error).toMatchObject({
            code: "SLACK_CHANNEL_NOT_FOUND",
            platformCode: "channel_not_found",
            operation: "conversations.info",
        });
    });

    it("目录分页检测停滞游标而不是永久循环", async () => {
        const bot = new SlackBot({ account_id: "A1", token: "xoxb-test" });
        bot.getWebClient().users.list = vi.fn().mockResolvedValue({
            ok: true,
            members: [],
            response_metadata: { next_cursor: "same" },
        });

        await expect(bot.getUserList()).rejects.toMatchObject({ code: "SLACK_CURSOR_STALLED" });
    });
});
