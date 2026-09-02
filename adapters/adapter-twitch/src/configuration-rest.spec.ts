import { describe, expect, it, vi } from "vitest";
import {
    assertHttpPath,
    assertTwitchApiPath,
    assertTwitchConfig,
    normalizeSubscription,
} from "./configuration.js";
import { FetchTwitchRestTransport } from "./rest.js";
import type { TwitchConfig } from "./types.js";

describe("Twitch configuration", () => {
    it("由目录推导稳定版本与完整 condition", () => {
        expect(normalizeSubscription({ type: "channel.chat.message" }, config())).toEqual({
            type: "channel.chat.message",
            version: "1",
            condition: { broadcaster_user_id: "100", user_id: "200" },
        });
        expect(normalizeSubscription({ type: "channel.follow" }, config())).toEqual({
            type: "channel.follow",
            version: "2",
            condition: { broadcaster_user_id: "100", moderator_user_id: "300" },
        });
        expect(normalizeSubscription({ type: "conduit.shard.disabled" }, config())).toEqual({
            type: "conduit.shard.disabled",
            version: "1",
            condition: { client_id: "client" },
        });
    });

    it("Drops 仅允许 Webhook、要求组织并启用官方批处理", () => {
        const webhook = config({ receive_mode: "webhook" });
        expect(
            normalizeSubscription(
                { type: "drop.entitlement.grant", organization_id: "organization" },
                webhook,
            ),
        ).toEqual({
            type: "drop.entitlement.grant",
            version: "1",
            condition: { organization_id: "organization" },
            is_batching_enabled: true,
        });
        expect(() => normalizeSubscription({ type: "drop.entitlement.grant" }, webhook)).toThrow(
            /organization_id/u,
        );
        expect(() =>
            normalizeSubscription(
                { type: "drop.entitlement.grant", organization_id: "organization" },
                config({ receive_mode: "websocket" }),
            ),
        ).toThrow(/不支持 websocket/u);
        expect(() =>
            normalizeSubscription(
                { type: "extension.bits_transaction.create" },
                config({ receive_mode: "websocket" }),
            ),
        ).toThrow(/不支持 websocket/u);
    });

    it("拒绝 Beta/未知类型、错误版本、歧义 raid 与无关 condition", () => {
        for (const type of [
            "channel.guest_star_session.begin",
            "channel.custom_powerup_redemption.add",
            "future.event",
        ]) {
            expect(() => normalizeSubscription({ type }, config())).toThrow(/稳定目录/u);
        }
        expect(() =>
            normalizeSubscription({ type: "channel.update", version: "1" }, config()),
        ).toThrow(/稳定 version/u);
        expect(() =>
            normalizeSubscription(
                {
                    type: "channel.raid",
                    from_broadcaster_user_id: "100",
                    to_broadcaster_user_id: "200",
                },
                config(),
            ),
        ).toThrow(/只能提供一个/u);
        expect(() =>
            normalizeSubscription({ type: "channel.update", moderator_user_id: "300" }, config()),
        ).toThrow(/不接受 condition/u);
    });

    it("严格限制 API path、Host path 与公网 Webhook callback", () => {
        expect(assertTwitchApiPath("chat/messages")).toBe("chat/messages");
        expect(assertHttpPath("/twitch/account/eventsub/")).toBe("/twitch/account/eventsub");
        for (const path of [
            "../users",
            "/users",
            "https://evil.example.com/users",
            "%2e%2e/users",
            "users/%2Fadmin",
            "users?q=1",
        ]) {
            expect(() => assertTwitchApiPath(path)).toThrow();
        }
        for (const path of ["relative", "//host/path", "/a/%2F/b", "/a/../b"]) {
            expect(() => assertHttpPath(path)).toThrow();
        }
        expect(() =>
            assertTwitchConfig(
                config({
                    receive_mode: "webhook",
                    webhook_callback_url: "https://events.example.com:8443/twitch",
                    webhook_secret: "0123456789",
                }),
            ),
        ).toThrow(/443/u);
        expect(() =>
            assertTwitchConfig(
                config({ reconnect_initial_delay_ms: 2_000, reconnect_max_delay_ms: 1_000 }),
            ),
        ).toThrow(/不能大于/u);
        expect(() =>
            assertTwitchConfig({ ...config(), subscriptions: {} } as unknown as TwitchConfig),
        ).toThrow(/subscriptions 必须是数组/u);
    });
});

describe("Twitch REST transport", () => {
    it("覆盖伪造鉴权、编码数组 query 并发送 JSON body", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));
        const rest = new FetchTwitchRestTransport(config(), fetcher);
        await rest.call("POST", "chat/messages", {
            query: { broadcaster_id: ["100", "101"], first: 20 },
            body: { message: "hello" },
            headers: { authorization: "Bearer forged", "client-id": "forged" },
        });

        const [input, init] = fetcher.mock.calls[0];
        const url = new URL(String(input));
        expect(url.pathname).toBe("/helix/chat/messages");
        expect(url.searchParams.getAll("broadcaster_id")).toEqual(["100", "101"]);
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
        expect(new Headers(init?.headers).get("client-id")).toBe("client");
        expect(init?.body).toBe(JSON.stringify({ message: "hello" }));
    });

    it("保留结构化 Helix 错误、请求 ID 与限流时间", async () => {
        const rest = new FetchTwitchRestTransport(
            config(),
            vi.fn<typeof fetch>().mockResolvedValue(
                Response.json(
                    { error: "Too Many Requests", status: 429, message: "slow down" },
                    {
                        status: 429,
                        headers: {
                            "retry-after": "2",
                            "ratelimit-reset": "2000000000",
                            "x-request-id": "request1",
                        },
                    },
                ),
            ),
        );
        await expect(rest.call("GET", "users")).rejects.toMatchObject({
            code: "TWITCH_TOO_MANY_REQUESTS",
            status: 429,
            requestId: "request1",
            retryAfterMs: 2_000,
            rateLimitResetAt: 2_000_000_000_000,
        });
    });

    it("限制声明长度和流式实际长度", async () => {
        const declared = new FetchTwitchRestTransport(
            config({ max_response_bytes: 1_024 }),
            vi
                .fn<typeof fetch>()
                .mockResolvedValue(new Response("x", { headers: { "content-length": "2048" } })),
        );
        await expect(declared.call("GET", "users")).rejects.toMatchObject({
            code: "TWITCH_RESPONSE_TOO_LARGE",
        });

        const actual = new FetchTwitchRestTransport(
            config({ max_response_bytes: 1_024 }),
            vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(2_048))),
        );
        await expect(actual.call("GET", "users")).rejects.toMatchObject({
            code: "TWITCH_RESPONSE_TOO_LARGE",
        });
    });
});

function config(overrides: Partial<TwitchConfig> = {}): TwitchConfig {
    return {
        account_id: "account",
        client_id: "client",
        access_token: "oauth:token",
        broadcaster_user_id: "100",
        bot_user_id: "200",
        moderator_user_id: "300",
        receive_mode: "manual",
        ...overrides,
    };
}
