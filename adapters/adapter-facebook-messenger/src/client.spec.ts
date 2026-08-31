import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FacebookMessengerClient } from "./client.js";
import type { FacebookMessengerConfig } from "./types.js";

describe("FacebookMessengerClient", () => {
    it("启动时验证 Page 身份、可选订阅，并合并并发 start", async () => {
        let release: (() => void) | undefined;
        const fetcher = vi.fn<typeof fetch>((input, init) => {
            const url = new URL(String(input));
            if (url.pathname === "/v25.0/100" && init?.method === "GET") {
                return new Promise(resolve => {
                    release = () => resolve(Response.json({ id: "100", name: "My Page" }));
                });
            }
            if (url.pathname === "/v25.0/100/subscribed_apps") {
                return Promise.resolve(Response.json({ success: true }));
            }
            throw new Error(`unexpected ${init?.method} ${url.pathname}`);
        });
        const client = new FacebookMessengerClient(
            config({ auto_subscribe: true, subscribed_fields: ["messages", "message_reads"] }),
            { fetcher },
        );
        const ready = vi.fn();
        client.on("ready", ready);
        const first = client.start();
        const second = client.start();
        release?.();
        await Promise.all([first, second]);

        expect(client.isStarted).toBe(true);
        expect(ready).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledTimes(2);
        const subscribeUrl = new URL(String(fetcher.mock.calls[1][0]));
        expect(subscribeUrl.searchParams.get("subscribed_fields")).toBe("messages,message_reads");
        expect(subscribeUrl.searchParams.has("access_token")).toBe(false);
        expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("authorization")).toBe(
            "Bearer page-token",
        );
    });

    it("Send API 使用 Page edge、默认 messaging type 与结构化响应", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(Response.json({ recipient_id: "200", message_id: "m1" }));
        const client = new FacebookMessengerClient(config({ receive_mode: "manual" }), {
            fetcher,
        });
        await expect(client.send("200", { text: "hello" })).resolves.toEqual({
            recipient_id: "200",
            message_id: "m1",
        });
        const [input, init] = fetcher.mock.calls[0];
        expect(new URL(String(input)).pathname).toBe("/v25.0/100/messages");
        expect(JSON.parse(String(init?.body))).toEqual({
            recipient: { id: "200" },
            messaging_type: "RESPONSE",
            message: { text: "hello" },
        });
    });

    it("acceptHttp 校验精确签名并展开 batch；业务失败允许 Meta 重试", async () => {
        const client = new FacebookMessengerClient(config());
        const listener = vi.fn().mockRejectedValueOnce(new Error("consumer unavailable"));
        client.on("event", listener);
        const body = JSON.stringify(webhook("m1"));
        const request = () =>
            new Request("https://host.example/facebook/page", {
                method: "POST",
                headers: { "x-hub-signature-256": signature(body) },
                body,
            });

        expect((await client.acceptHttp(request())).status).toBe(500);
        expect((await client.acceptHttp(request())).status).toBe(200);
        expect((await client.acceptHttp(request())).status).toBe(200);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("GET challenge 与 manual ingest 使用同一严格 codec", async () => {
        const webhookClient = new FacebookMessengerClient(config());
        const challenge = await webhookClient.acceptHttp(
            new Request(
                "https://host.example/facebook/page?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=OK",
            ),
        );
        expect(challenge.status).toBe(200);
        await expect(challenge.text()).resolves.toBe("OK");

        const manual = new FacebookMessengerClient(config({ receive_mode: "manual" }));
        const event = vi.fn();
        manual.on("event", event);
        await expect(manual.ingest(webhook("m2"))).resolves.toMatchObject([
            { accepted: true, duplicate: false },
        ]);
        expect(event).toHaveBeenCalledWith(
            expect.objectContaining({ event: expect.objectContaining({ event_type: "message" }) }),
        );
    });

    it("拒绝 token 对应错误 Page 与无标签的 MESSAGE_TAG", async () => {
        const client = new FacebookMessengerClient(config({ receive_mode: "manual" }), {
            fetcher: vi
                .fn<typeof fetch>()
                .mockResolvedValue(Response.json({ id: "999", name: "Wrong" })),
        });
        await expect(client.start()).rejects.toMatchObject({
            code: "FACEBOOK_MESSENGER_PAGE_ID_MISMATCH",
        });
        await expect(
            client.send("200", { text: "hello" }, { messagingType: "MESSAGE_TAG" }),
        ).rejects.toThrow(/必须提供 tag/u);
    });
});

function config(overrides: Partial<FacebookMessengerConfig> = {}): FacebookMessengerConfig {
    return {
        account_id: "page",
        page_id: "100",
        page_access_token: "page-token",
        app_secret: "secret",
        verify_token: "verify",
        http_path: "/facebook/page",
        api_version: "v25.0",
        ...overrides,
    };
}

function webhook(mid: string): Record<string, unknown> {
    return {
        object: "page",
        entry: [
            {
                id: "100",
                time: 1_788_000_000_000,
                messaging: [
                    {
                        sender: { id: "200" },
                        recipient: { id: "100" },
                        timestamp: 1_788_000_000_001,
                        message: { mid, text: "hello" },
                    },
                ],
            },
        ],
    };
}

function signature(body: string): string {
    return `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
}
