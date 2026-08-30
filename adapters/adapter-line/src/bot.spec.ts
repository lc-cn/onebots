import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LineBot } from "./bot.js";

describe("LineBot Webhook 契约", () => {
    it("基于原始请求体验签并按 webhookEventId 去重", async () => {
        const bot = createBot();
        const listener = vi.fn();
        bot.on("event", listener);
        const body = JSON.stringify({
            destination: "U00000000000000000000000000000000",
            events: [
                {
                    type: "unsend",
                    timestamp: 1,
                    mode: "active",
                    webhookEventId: "evt-1",
                    deliveryContext: { isRedelivery: false },
                    unsend: { messageId: "M1" },
                },
            ],
        });
        const signature = createHmac("sha256", "secret").update(body).digest("base64");

        await expect(bot.ingestHttp({ method: "POST", body, signature })).resolves.toMatchObject({
            status: 200,
            ingest: { accepted: 1, duplicate: 0 },
        });
        expect(bot.getBotUserId()).toBe("U00000000000000000000000000000000");
        await expect(bot.ingestHttp({ method: "POST", body, signature })).resolves.toMatchObject({
            status: 200,
            ingest: { accepted: 0, duplicate: 1 },
        });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("拒绝篡改请求与非 HTTPS API 地址", async () => {
        const bot = createBot();
        await expect(
            bot.ingestHttp({ method: "POST", body: "{}", signature: "invalid" }),
        ).resolves.toMatchObject({
            status: 401,
            body: { error: { code: "LINE_INVALID_SIGNATURE" } },
        });
        expect(
            () =>
                new LineBot({
                    account_id: "test",
                    channel_access_token: "token",
                    channel_secret: "secret",
                    api_base_url: "http://127.0.0.1",
                }),
        ).toThrow(/HTTPS URL/u);
        expect(
            () =>
                new LineBot({
                    account_id: "test",
                    channel_access_token: "token",
                    channel_secret: "secret",
                    api_base_url: "https://user:pass@example.test",
                }),
        ).toThrow(/无凭据/u);
    });

    it("异步事件分发失败时释放去重占位，允许 LINE 重投递", async () => {
        const bot = createBot();
        const body = JSON.stringify({
            destination: "U00000000000000000000000000000000",
            events: [
                {
                    type: "unsend",
                    timestamp: 1,
                    mode: "active",
                    webhookEventId: "evt-retry",
                    deliveryContext: { isRedelivery: false },
                    unsend: { messageId: "M1" },
                },
            ],
        });
        const signature = createHmac("sha256", "secret").update(body).digest("base64");
        const failure = vi.fn().mockRejectedValue(new Error("downstream failed"));
        bot.on("event", failure);
        await expect(bot.ingestHttp({ method: "POST", body, signature })).resolves.toMatchObject({
            status: 500,
        });
        bot.off("event", failure);
        await expect(bot.ingestHttp({ method: "POST", body, signature })).resolves.toMatchObject({
            ingest: { accepted: 1 },
        });
    });

    it("manual ingest 接收单个原始事件且无需 channel_secret", async () => {
        const bot = new LineBot({
            account_id: "test",
            channel_access_token: "token",
            receive_mode: "manual",
        });
        const listener = vi.fn();
        const unsubscribe = bot.onEvent("unsend", listener);
        const event = webhookEvent("evt-manual");
        await expect(bot.ingest(event)).resolves.toMatchObject({ accepted: 1, duplicate: 0 });
        expect(listener).toHaveBeenCalledWith(event);
        unsubscribe();
        await expect(bot.ingest(webhookEvent("evt-unsubscribed"))).resolves.toMatchObject({
            accepted: 1,
        });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("合并并发重投且只让首个调用报告已接收", async () => {
        const bot = createBot();
        let release: (() => void) | undefined;
        const listener = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );
        bot.on("event", listener);
        const event = webhookEvent("evt-concurrent");

        const first = bot.ingest(event);
        const follower = bot.ingest(event);
        await Promise.resolve();
        expect(listener).toHaveBeenCalledOnce();
        release?.();

        await expect(Promise.all([first, follower])).resolves.toEqual([
            { accepted: 1, duplicate: 0, events: [event] },
            { accepted: 0, duplicate: 1, events: [] },
        ]);
    });

    it("acceptHttp 返回结构化响应并拒绝错误方法", async () => {
        const bot = createBot();
        const body = JSON.stringify({
            destination: "U00000000000000000000000000000000",
            events: [webhookEvent("evt-http")],
        });
        const signature = createHmac("sha256", "secret").update(body).digest("base64");
        const response = await bot.acceptHttp(
            new Request("https://example.test/line", {
                method: "POST",
                body,
                headers: { "x-line-signature": signature },
            }),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
        expect(await response.json()).toEqual({ ok: true, accepted: 1, duplicate: 0 });
        const methodNotAllowed = await bot.acceptHttp(new Request("https://example.test/line"));
        expect(methodNotAllowed.status).toBe(405);
        expect(methodNotAllowed.headers.get("allow")).toBe("POST");
    });

    it("Koa 风格 Host 与 Fetch Host 复用同一结构化 HTTP 边界", async () => {
        const bot = createBot();
        const body = JSON.stringify({
            destination: "U00000000000000000000000000000000",
            events: [webhookEvent("evt-koa")],
        });
        const signature = createHmac("sha256", "secret").update(body).digest("base64");
        const context = {
            method: "POST",
            request: { rawBody: body },
            get: (name: string) => (name === "x-line-signature" ? signature : ""),
            set: vi.fn(),
            status: 0,
            body: undefined as unknown,
        };

        await bot.acceptHttp(context);

        expect(context.status).toBe(200);
        expect(context.set).toHaveBeenCalledWith("Content-Type", "application/json; charset=utf-8");
        expect(context.body).toEqual({ ok: true, accepted: 1, duplicate: 0 });
    });

    it("可按 destination 拒绝发给其他机器人的 Webhook", async () => {
        const bot = new LineBot({
            account_id: "test",
            channel_access_token: "token",
            channel_secret: "secret",
            destination: "U11111111111111111111111111111111",
        });
        await expect(
            bot.ingest({
                destination: "U22222222222222222222222222222222",
                events: [webhookEvent("evt-other-bot")],
            }),
        ).rejects.toThrow(/destination/u);
    });
});

function webhookEvent(eventId: string) {
    return {
        type: "unsend" as const,
        timestamp: 1,
        mode: "active" as const,
        webhookEventId: eventId,
        deliveryContext: { isRedelivery: false },
        unsend: { messageId: "M1" },
    };
}

function createBot(): LineBot {
    return new LineBot({
        account_id: "test",
        channel_access_token: "token",
        channel_secret: "secret",
    });
}
