import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InstagramClient } from "./client.js";
import type { InstagramConfig } from "./types.js";

describe("InstagramClient", () => {
    it("启动时验证 Professional Account、可选订阅，并合并并发 start", async () => {
        let release: (() => void) | undefined;
        const fetcher = vi.fn<typeof fetch>((input, init) => {
            const url = new URL(String(input));
            if (url.pathname === "/v25.0/100" && init?.method === "GET") {
                return new Promise(resolve => {
                    release = () => resolve(Response.json({ id: "100", username: "onebots.test" }));
                });
            }
            if (url.pathname === "/v25.0/100/subscribed_apps") {
                return Promise.resolve(Response.json({ success: true }));
            }
            throw new Error(`unexpected ${init?.method} ${url.pathname}`);
        });
        const client = new InstagramClient(
            config({ auto_subscribe: true, subscribed_fields: ["messages", "messaging_seen"] }),
            { fetcher },
        );
        const ready = vi.fn();
        client.on("ready", ready);
        const first = client.start();
        const second = client.start();
        release?.();
        await Promise.all([first, second]);

        expect(client.businessProfile?.username).toBe("onebots.test");
        expect(ready).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledTimes(2);
        const subscribeUrl = new URL(String(fetcher.mock.calls[1][0]));
        expect(subscribeUrl.origin).toBe("https://graph.instagram.com");
        expect(subscribeUrl.searchParams.get("subscribed_fields")).toBe("messages,messaging_seen");
        expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("authorization")).toBe(
            "Bearer instagram-token",
        );
    });

    it("Send、Human Agent、private reply 与 reaction 使用官方 Instagram edge", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockImplementation(() =>
                Promise.resolve(Response.json({ recipient_id: "200", message_id: "m1" })),
            );
        const client = new InstagramClient(config({ receive_mode: "manual" }), { fetcher });

        await client.send("200", { text: "hello" });
        await client.send("200", { text: "human" }, { humanAgent: true });
        await client.sendPrivateReply("300", "private");
        await client.react("200", "m1", "react");

        expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(
            Array(4).fill("/v25.0/100/messages"),
        );
        expect(body(fetcher, 0)).toEqual({ recipient: { id: "200" }, message: { text: "hello" } });
        expect(body(fetcher, 1)).toMatchObject({ tag: "HUMAN_AGENT" });
        expect(body(fetcher, 2)).toEqual({
            recipient: { comment_id: "300" },
            message: { text: "private" },
        });
        expect(body(fetcher, 3)).toEqual({
            recipient: { id: "200" },
            sender_action: "react",
            payload: { message_id: "m1", reaction: "love" },
        });
    });

    it("Conversations API 固定 platform=instagram，并限制消息详情为最近 20 条", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ data: [] }))
            .mockResolvedValueOnce(
                Response.json({
                    id: "c1",
                    messages: { data: [] },
                }),
            );
        const client = new InstagramClient(config({ receive_mode: "manual" }), { fetcher });
        await client.listConversations("cursor", 50);
        await client.getConversation("c1", 99);

        const listUrl = new URL(String(fetcher.mock.calls[0][0]));
        expect(listUrl.searchParams.get("platform")).toBe("instagram");
        expect(listUrl.searchParams.get("after")).toBe("cursor");
        expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("fields")).toContain(
            "messages.limit(20)",
        );
    });

    it("acceptHttp 校验精确签名；manual ingest 走同一个严格 codec", async () => {
        const webhookClient = new InstagramClient(config());
        const event = vi.fn();
        webhookClient.on("event", event);
        const raw = JSON.stringify(webhook("m1"));
        const response = await webhookClient.acceptHttp(
            new Request("https://host.example/instagram/account", {
                method: "POST",
                headers: { "x-hub-signature-256": signature(raw) },
                body: raw,
            }),
        );
        expect(response.status).toBe(200);
        expect(event).toHaveBeenCalledOnce();

        const manual = new InstagramClient(config({ receive_mode: "manual" }));
        await expect(manual.ingest(webhook("m2"))).resolves.toMatchObject([
            { accepted: true, duplicate: false },
        ]);
    });

    it("拒绝 token 对应错误 Instagram User ID", async () => {
        const client = new InstagramClient(config({ receive_mode: "manual" }), {
            fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "999" })),
        });
        await expect(client.start()).rejects.toMatchObject({
            code: "INSTAGRAM_USER_ID_MISMATCH",
        });
    });
});

function body(fetcher: ReturnType<typeof vi.fn<typeof fetch>>, index: number): unknown {
    return JSON.parse(String(fetcher.mock.calls[index][1]?.body));
}

function config(overrides: Partial<InstagramConfig> = {}): InstagramConfig {
    return {
        account_id: "account",
        instagram_user_id: "100",
        access_token: "instagram-token",
        app_secret: "secret",
        verify_token: "verify",
        http_path: "/instagram/account",
        api_version: "v25.0",
        ...overrides,
    };
}

function webhook(mid: string): Record<string, unknown> {
    return {
        object: "instagram",
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

function signature(raw: string): string {
    return `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
}
