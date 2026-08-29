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

        expect(bot.ingest(body, signature)).toBe(1);
        expect(bot.ingest(body, signature)).toBe(0);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("拒绝篡改请求与非 HTTPS API 地址", () => {
        const bot = createBot();
        expect(() => bot.ingest("{}", "invalid")).toThrow(/签名/u);
        expect(
            () =>
                new LineBot({
                    account_id: "test",
                    channel_access_token: "token",
                    channel_secret: "secret",
                    api_base_url: "http://127.0.0.1",
                }),
        ).toThrow(/HTTPS URL/u);
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
        expect(() => bot.ingest(body, signature)).toThrow("downstream failed");
        bot.off("event", failure);
        expect(bot.ingest(body, signature)).toBe(1);
    });
});

function createBot(): LineBot {
    return new LineBot({
        account_id: "test",
        channel_access_token: "token",
        channel_secret: "secret",
    });
}
