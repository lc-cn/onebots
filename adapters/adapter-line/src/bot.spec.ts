import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LineBot } from "./bot.js";

describe("LineBot Webhook 契约", () => {
    it("基于原始请求体验签并按 webhookEventId 去重", () => {
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

        expect(bot.ingestHttp(body, signature)).toMatchObject({ accepted: 1, duplicate: 0 });
        expect(bot.ingestHttp(body, signature)).toMatchObject({ accepted: 0, duplicate: 1 });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("拒绝篡改请求与非 HTTPS API 地址", () => {
        const bot = createBot();
        expect(() => bot.ingestHttp("{}", "invalid")).toThrow(/签名/u);
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

    it("事件分发失败时释放去重占位，允许 LINE 重投递", () => {
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
        const failure = (): void => {
            throw new Error("downstream failed");
        };
        bot.on("event", failure);
        expect(() => bot.ingestHttp(body, signature)).toThrow("downstream failed");
        bot.off("event", failure);
        expect(bot.ingestHttp(body, signature).accepted).toBe(1);
    });

    it("manual ingest 接收单个原始事件且无需 channel_secret", () => {
        const bot = new LineBot({
            account_id: "test",
            channel_access_token: "token",
            receive_mode: "manual",
        });
        const listener = vi.fn();
        const unsubscribe = bot.onEvent("unsend", listener);
        const event = webhookEvent("evt-manual");
        expect(bot.ingest(event)).toMatchObject({ accepted: 1, duplicate: 0 });
        expect(listener).toHaveBeenCalledWith(event);
        unsubscribe();
        expect(bot.ingest(webhookEvent("evt-unsubscribed")).accepted).toBe(1);
        expect(listener).toHaveBeenCalledTimes(1);
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
        expect(await response.json()).toEqual({ ok: true, accepted: 1, duplicate: 0 });
        expect((await bot.acceptHttp(new Request("https://example.test/line"))).status).toBe(405);
    });

    it("可按 destination 拒绝发给其他机器人的 Webhook", () => {
        const bot = new LineBot({
            account_id: "test",
            channel_access_token: "token",
            channel_secret: "secret",
            destination: "U11111111111111111111111111111111",
        });
        expect(() =>
            bot.ingest({
                destination: "U22222222222222222222222222222222",
                events: [webhookEvent("evt-other-bot")],
            }),
        ).toThrow(/destination/u);
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
