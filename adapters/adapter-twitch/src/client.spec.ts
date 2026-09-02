import { describe, expect, it, vi } from "vitest";
import { TwitchClient } from "./client.js";
import type { TwitchRestTransport } from "./rest.js";
import type { TwitchConfig, TwitchEventSubMessage } from "./types.js";

describe("TwitchClient lifecycle", () => {
    it("manual start 合并并发启动、验证身份并由 AbortSignal 停止", async () => {
        const fetcher = tokenFetcher({ user_id: "200" });
        const rest: TwitchRestTransport = {
            call: vi.fn().mockResolvedValue({ data: [user("200")] }),
        };
        const client = new TwitchClient(config(), { fetcher, rest });
        const ready = vi.fn();
        const stopped = vi.fn();
        client.on("ready", ready);
        client.on("stop", stopped);
        const controller = new AbortController();

        await Promise.all([client.start(controller.signal), client.start(controller.signal)]);
        expect(client.me).toMatchObject({ id: "200", login: "bot" });
        expect(client.tokenInfo?.scopes).toEqual(["user:read:chat"]);
        expect(ready).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledOnce();

        controller.abort(new Error("shutdown"));
        await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
        expect(client.isStarted).toBe(false);
    });

    it("WebSocket 拒绝应用令牌，Webhook 自动订阅拒绝用户令牌", async () => {
        const rest: TwitchRestTransport = { call: vi.fn() };
        const websocket = new TwitchClient(config({ receive_mode: "websocket" }), {
            fetcher: tokenFetcher({ user_id: undefined }),
            rest,
        });
        await expect(websocket.start()).rejects.toMatchObject({
            code: "TWITCH_WEBSOCKET_USER_TOKEN_REQUIRED",
        });

        const webhook = new TwitchClient(
            config({
                receive_mode: "webhook",
                webhook_callback_url: "https://events.example.com/twitch",
                webhook_secret: "0123456789",
            }),
            { fetcher: tokenFetcher({ user_id: "200" }), rest },
        );
        await expect(webhook.start()).rejects.toMatchObject({
            code: "TWITCH_WEBHOOK_APP_TOKEN_REQUIRED",
        });
    });
});

describe("TwitchClient ingress", () => {
    it("过滤、去重且 handler 失败后允许同一投递重试", async () => {
        const client = new TwitchClient(
            config({ subscriptions: [{ type: "channel.chat.message" }] }),
        );
        const handler = vi.fn().mockRejectedValueOnce(new Error("downstream failed"));
        client.on("event", handler);
        const packet = notification("message1", "channel.chat.message", {
            message_id: "chat1",
        });

        await expect(client.ingest(packet)).rejects.toThrow("downstream failed");
        handler.mockResolvedValue(undefined);
        await expect(client.ingest(packet)).resolves.toMatchObject({
            accepted: true,
            duplicate: false,
            filtered: false,
        });
        await expect(client.ingest(packet)).resolves.toMatchObject({
            accepted: false,
            duplicate: true,
        });
        await expect(
            client.ingest(notification("follow1", "channel.follow", { user_id: "300" })),
        ).resolves.toMatchObject({ filtered: true, duplicate: false });
    });

    it("完整展开 Drops 批量 events，并保持单次 envelope 级幂等", async () => {
        const client = new TwitchClient(
            config({
                receive_mode: "manual",
                subscriptions: [
                    { type: "drop.entitlement.grant", organization_id: "organization" },
                ],
            }),
        );
        const handler = vi.fn().mockResolvedValue(undefined);
        client.on("event", handler);
        const packet = notification("drop1", "drop.entitlement.grant", undefined, [
            { id: "entitlement1", data: { user_id: "300" } },
            { id: "entitlement2", data: { user_id: "301" } },
        ]);

        const first = await client.ingest(packet);
        expect(first.deliveries).toHaveLength(2);
        expect(first.deliveries.map(item => item.batchIndex)).toEqual([0, 1]);
        expect(handler).toHaveBeenCalledTimes(2);
        await expect(client.ingest(packet)).resolves.toMatchObject({ duplicate: true });
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it("拒绝 challenge 绕过 HTTP 边界和畸形 envelope", async () => {
        const client = new TwitchClient(config());
        const verification = envelope("verification1", "webhook_callback_verification", {
            subscription: subscription("channel.chat.message"),
            challenge: "challenge",
        });
        await expect(client.ingest(verification)).rejects.toThrow(/acceptHttp/u);
        await expect(client.ingest({ metadata: {}, payload: {} })).rejects.toMatchObject({
            code: "TWITCH_PROTOCOL_ERROR",
        });
    });
});

function tokenFetcher(overrides: { user_id: string | undefined }) {
    return vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
            client_id: "client",
            login: overrides.user_id ? "bot" : undefined,
            scopes: ["user:read:chat"],
            user_id: overrides.user_id,
            expires_in: 3600,
        }),
    );
}

function config(overrides: Partial<TwitchConfig> = {}): TwitchConfig {
    return {
        account_id: "account",
        client_id: "client",
        access_token: "token",
        broadcaster_user_id: "100",
        bot_user_id: "200",
        moderator_user_id: "300",
        receive_mode: "manual",
        ...overrides,
    };
}

function user(id: string) {
    return {
        id,
        login: "bot",
        display_name: "Bot",
        type: "",
        broadcaster_type: "",
        description: "",
        profile_image_url: "https://static.example.com/avatar.png",
        offline_image_url: "",
        created_at: "2026-09-02T10:00:00Z",
    };
}

function notification(
    id: string,
    type: string,
    event?: Record<string, unknown>,
    events?: Record<string, unknown>[],
): TwitchEventSubMessage {
    return envelope(id, "notification", {
        subscription: subscription(type),
        event,
        events,
    });
}

function envelope(
    id: string,
    messageType: TwitchEventSubMessage["metadata"]["message_type"],
    payload: TwitchEventSubMessage["payload"],
): TwitchEventSubMessage {
    return {
        metadata: {
            message_id: id,
            message_type: messageType,
            message_timestamp: "2026-09-02T10:00:00Z",
        },
        payload,
    };
}

function subscription(type: string) {
    return {
        id: "subscription1",
        status: "enabled",
        type,
        version: "1",
        cost: 0,
        condition: { broadcaster_user_id: "100", user_id: "200" },
        transport: { method: "webhook" },
        created_at: "2026-09-02T10:00:00Z",
    };
}
