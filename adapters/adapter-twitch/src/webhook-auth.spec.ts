import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseTokenInfo, validateTwitchToken } from "./auth.js";
import { TwitchWebhookHandler } from "./webhook.js";
import type { TwitchConfig, TwitchIngestResult } from "./types.js";

const now = Date.parse("2026-09-02T10:00:00Z");

describe("Twitch OAuth validation", () => {
    it("标准化 oauth: 前缀、解析 scope 并验证 Client ID", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            Response.json({
                client_id: "client",
                login: "bot",
                scopes: ["user:read:chat", "user:read:chat"],
                user_id: "200",
                expires_in: 3600,
            }),
        );
        await expect(validateTwitchToken(config(), fetcher)).resolves.toEqual({
            client_id: "client",
            login: "bot",
            scopes: ["user:read:chat"],
            user_id: "200",
            expires_in: 3600,
        });
        expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("authorization")).toBe(
            "OAuth token",
        );
    });

    it("拒绝 Client ID 不一致、畸形 scope 与超大响应", async () => {
        await expect(
            validateTwitchToken(
                config(),
                vi.fn<typeof fetch>().mockResolvedValue(
                    Response.json({
                        client_id: "other",
                        scopes: [],
                        expires_in: 1,
                    }),
                ),
            ),
        ).rejects.toMatchObject({ code: "TWITCH_CLIENT_ID_MISMATCH" });
        expect(() => parseTokenInfo({ client_id: "client", scopes: [1], expires_in: 1 })).toThrow(
            /scopes/u,
        );
        await expect(
            validateTwitchToken(
                config(),
                vi
                    .fn<typeof fetch>()
                    .mockResolvedValue(
                        new Response("x", { headers: { "content-length": "70000" } }),
                    ),
            ),
        ).rejects.toMatchObject({ code: "TWITCH_AUTH_RESPONSE_TOO_LARGE" });
    });
});

describe("Twitch EventSub Webhook", () => {
    it("验证原始 body HMAC 并原样响应 challenge", async () => {
        const ingest = vi.fn<(message: never) => Promise<TwitchIngestResult>>();
        const handler = new TwitchWebhookHandler(config(), { ingest, now: () => now });
        const request = signedRequest("verification1", "webhook_callback_verification", {
            challenge: "challenge-value",
            subscription: subscription("channel.chat.message"),
        });
        const response = await handler.acceptHttp(request);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/plain");
        await expect(response.text()).resolves.toBe("challenge-value");
        expect(ingest).not.toHaveBeenCalled();
    });

    it("将 notification 交给同一 ingress 并返回重复/过滤结构头", async () => {
        const ingest = vi.fn().mockResolvedValue({
            accepted: false,
            duplicate: true,
            filtered: false,
            deliveries: [],
        });
        const handler = new TwitchWebhookHandler(config(), { ingest, now: () => now });
        const response = await handler.acceptHttp(
            signedRequest("notification1", "notification", {
                subscription: subscription("channel.chat.message"),
                event: { message_id: "message1" },
            }),
        );

        expect(response.status).toBe(204);
        expect(response.headers.get("x-onebots-duplicate")).toBe("true");
        expect(response.headers.get("x-onebots-filtered")).toBe("false");
        expect(ingest).toHaveBeenCalledOnce();
    });

    it("拒绝错误签名、过期时间、方法和超大 body", async () => {
        const handler = new TwitchWebhookHandler(config({ max_response_bytes: 1_024 }), {
            ingest: vi.fn(),
            now: () => now,
        });
        const invalid = signedRequest("invalid1", "notification", {
            subscription: subscription("channel.chat.message"),
            event: {},
        });
        invalid.headers.set("twitch-eventsub-message-signature", "sha256=bad");
        expect((await handler.acceptHttp(invalid)).status).toBe(403);

        const stale = signedRequest(
            "stale1",
            "notification",
            { subscription: subscription("channel.chat.message"), event: {} },
            "2026-09-02T09:00:00Z",
        );
        expect((await handler.acceptHttp(stale)).status).toBe(403);
        expect(
            (await handler.acceptHttp(new Request("https://example.com", { method: "GET" })))
                .status,
        ).toBe(405);

        const large = signedRequest("large1", "notification", {
            subscription: subscription("channel.chat.message"),
            event: { text: "x".repeat(2_000) },
        });
        expect((await handler.acceptHttp(large)).status).toBe(413);
    });
});

function signedRequest(
    id: string,
    type: string,
    payload: Record<string, unknown>,
    timestamp = "2026-09-02T10:00:00Z",
): Request {
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac("sha256", "0123456789")
        .update(id)
        .update(timestamp)
        .update(body)
        .digest("hex")}`;
    return new Request("https://events.example.com/twitch", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "twitch-eventsub-message-id": id,
            "twitch-eventsub-message-type": type,
            "twitch-eventsub-message-timestamp": timestamp,
            "twitch-eventsub-message-signature": signature,
        },
        body,
    });
}

function subscription(type: string) {
    return {
        id: "subscription1",
        status: "enabled",
        type,
        version: "1",
        cost: 0,
        condition: { broadcaster_user_id: "100", user_id: "200" },
        transport: { method: "webhook", callback: "https://events.example.com/twitch" },
        created_at: "2026-09-02T10:00:00Z",
    };
}

function config(overrides: Partial<TwitchConfig> = {}): TwitchConfig {
    return {
        account_id: "account",
        client_id: "client",
        access_token: "oauth:token",
        broadcaster_user_id: "100",
        bot_user_id: "200",
        receive_mode: "webhook",
        webhook_callback_url: "https://events.example.com/twitch",
        webhook_secret: "0123456789",
        webhook_tolerance_seconds: 600,
        ...overrides,
    };
}
