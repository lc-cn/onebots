import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import type { WhatsAppConfig } from "./types.js";

const config: WhatsAppConfig = {
    account_id: "bot",
    app_secret: "secret",
    business_account_id: "waba",
    phone_number_id: "phone",
    access_token: "token",
    webhook_verify_token: "verify",
    api_version: "v23.0",
};

describe("WhatsAppClient", () => {
    it("并发启动共享请求，stop 使迟到结果失效且允许重新启动", async () => {
        let release: ((response: Response) => void) | undefined;
        const firstResponse = new Promise<Response>(resolve => {
            release = resolve;
        });
        const fetcher = vi
            .fn<typeof fetch>()
            .mockReturnValueOnce(firstResponse)
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ id: "phone", verified_name: "OneBots" }), {
                    headers: { "content-type": "application/json" },
                }),
            );
        const client = new WhatsAppClient(config, fetcher);
        const ready = vi.fn();
        const stopped = vi.fn();
        client.on("ready", ready);
        client.on("stop", stopped);

        const first = client.start();
        const concurrent = client.start();
        await client.stop();
        const restartController = new AbortController();
        const restarted = client.start(restartController.signal);
        await expect(restarted).resolves.toMatchObject({ verified_name: "OneBots" });
        release?.(
            new Response(JSON.stringify({ id: "phone" }), {
                headers: { "content-type": "application/json" },
            }),
        );

        await expect(first).rejects.toMatchObject({ code: "WHATSAPP_START_CANCELLED" });
        await expect(concurrent).rejects.toMatchObject({ code: "WHATSAPP_START_CANCELLED" });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(ready).toHaveBeenCalledOnce();
        stopped.mockClear();
        restartController.abort(new Error("protocol startup failed"));
        await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
    });

    it("启动取消会中止 Phone Number 身份请求并保留取消原因", async () => {
        let requestSignal: AbortSignal | undefined;
        const fetcher = vi.fn<typeof fetch>((_url, init) => {
            requestSignal = init?.signal ?? undefined;
            return new Promise<Response>((_resolve, reject) => {
                requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
                    once: true,
                });
            });
        });
        const client = new WhatsAppClient(config, fetcher);
        const stopped = vi.fn();
        client.on("stop", stopped);
        const controller = new AbortController();
        const starting = client.start(controller.signal);
        await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));

        const reason = new Error("account startup timeout");
        controller.abort(reason);

        await expect(starting).rejects.toBe(reason);
        expect(requestSignal?.aborted).toBe(true);
        await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
    });

    it("身份就绪后继续响应账号信号以支持协议启动回滚", async () => {
        const fetcher = vi.fn<typeof fetch>().mockImplementation(
            async () =>
                new Response(JSON.stringify({ id: "phone", verified_name: "OneBots" }), {
                    headers: { "content-type": "application/json" },
                }),
        );
        const client = new WhatsAppClient(config, fetcher);
        const stopped = vi.fn();
        client.on("stop", stopped);
        const controller = new AbortController();

        await expect(client.start(controller.signal)).resolves.toMatchObject({ id: "phone" });
        controller.abort(new Error("protocol startup failed"));

        await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
        await expect(client.start()).resolves.toMatchObject({ id: "phone" });
        expect(fetcher).toHaveBeenCalledTimes(2);
        await client.stop();
    });

    it("使用版本化 Graph API 路径并携带 Bearer Token", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ id: "phone" }), {
                headers: { "content-type": "application/json" },
            }),
        );
        const client = new WhatsAppClient(config, fetcher);
        await client.getPhoneNumberInfo();
        const [url, request] = fetcher.mock.calls[0] || [];
        expect(String(url)).toContain("/v23.0/phone?fields=");
        expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer token");
    });

    it("拒绝绝对 URL，避免访问令牌发送到非配置域名", async () => {
        const client = new WhatsAppClient(config);
        await expect(client.call({ resource: "https://evil.example/me" })).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESOURCE",
        } satisfies Partial<WhatsAppApiError>);
    });

    it.each(["/phone", "phone?fields=id", "phone#token", "phone/../me", "phone/%2e%2e/me"])(
        "拒绝夹带 URL 语义的 resource: %s",
        async resource => {
            const client = new WhatsAppClient(config);
            await expect(client.call({ resource })).rejects.toMatchObject({
                code: "WHATSAPP_INVALID_RESOURCE",
            });
        },
    );

    it("允许 Graph API 的 upload: 资源 ID", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ id: "upload:session" }), {
                headers: { "content-type": "application/json" },
            }),
        );
        const client = new WhatsAppClient(config, fetcher);
        await client.call({ resource: "upload:session" });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain("/v23.0/upload:session");
    });

    it("保留 Graph API 的结构化错误", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ error: { message: "Denied", code: 10 } }), {
                status: 403,
                headers: { "content-type": "application/json" },
            }),
        );
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.getPhoneNumberInfo()).rejects.toMatchObject({
            code: "WHATSAPP_10",
            status: 403,
            details: { error: { message: "Denied", code: 10 } },
        });
    });

    it("从统一 ingest 入口分发完整 Webhook 与细粒度事件", async () => {
        const client = new WhatsAppClient(config);
        const raw = vi.fn();
        const message = vi.fn();
        const status = vi.fn();
        client.on("raw_event", raw);
        client.on("message", message);
        client.on("status", status);
        const event = {
            object: "whatsapp_business_account" as const,
            entry: [
                {
                    id: "waba",
                    changes: [
                        {
                            field: "messages",
                            value: {
                                messages: [
                                    { id: "m1", from: "1", timestamp: "1", type: "text" as const },
                                ],
                                statuses: [
                                    {
                                        id: "m2",
                                        recipient_id: "1",
                                        timestamp: "2",
                                        status: "read" as const,
                                    },
                                ],
                            },
                        },
                    ],
                },
            ],
        };
        await expect(client.ingest(event)).resolves.toMatchObject({
            accepted: 2,
            duplicate: false,
            changes: 1,
            messages: 1,
            statuses: 1,
        });
        expect(raw).toHaveBeenCalledWith(event);
        expect(message).toHaveBeenCalledTimes(1);
        expect(status).toHaveBeenCalledTimes(1);
        expect(client.getObservedContact("1")).toBeUndefined();
    });

    it("只记录 Webhook 实际提供的联系人资料", async () => {
        const client = new WhatsAppClient(config);
        const observedDuringDispatch = vi.fn();
        client.on("webhook", () => {
            observedDuringDispatch(client.getObservedContact("86123"));
        });
        await client.ingest({
            object: "whatsapp_business_account",
            entry: [
                {
                    id: "waba",
                    changes: [
                        {
                            field: "messages",
                            value: {
                                contacts: [{ profile: { name: "Alice" }, wa_id: "86123" }],
                            },
                        },
                    ],
                },
            ],
        });
        expect(client.getObservedContact("86123")).toEqual({ id: "86123", name: "Alice" });
        expect(client.getObservedContact("unknown")).toBeUndefined();
        expect(observedDuringDispatch).toHaveBeenCalledWith({ id: "86123", name: "Alice" });
    });

    it("用 BSUID 作为首选身份，并为 wa_id 与 username 保留可查询别名", async () => {
        const client = new WhatsAppClient(config);
        await client.ingest({
            object: "whatsapp_business_account",
            entry: [
                {
                    id: "waba",
                    changes: [
                        {
                            field: "messages",
                            value: {
                                contacts: [
                                    {
                                        profile: { name: "Alice" },
                                        user_id: "BR.123",
                                        wa_id: "86123",
                                        username: "alice",
                                    },
                                ],
                            },
                        },
                    ],
                },
            ],
        });

        const expected = { id: "BR.123", name: "Alice" };
        expect(client.getObservedContact("BR.123")).toEqual(expected);
        expect(client.getObservedContact("86123")).toEqual(expected);
        expect(client.getObservedContact("alice")).toEqual(expected);
    });

    it("把每个 Groups webhook entry 投递到 typed group_update", async () => {
        const client = new WhatsAppClient(config);
        const groupUpdate = vi.fn();
        client.on("group_update", groupUpdate);
        const group = {
            timestamp: "20",
            group_id: "group@g.us",
            type: "group_suspend" as const,
        };

        await expect(
            client.ingest({
                object: "whatsapp_business_account",
                entry: [
                    {
                        id: "waba",
                        changes: [{ field: "group_status_update", value: { groups: [group] } }],
                    },
                ],
            }),
        ).resolves.toMatchObject({ accepted: 1, groupUpdates: 1 });
        expect(groupUpdate).toHaveBeenCalledWith(
            group,
            expect.objectContaining({ field: "group_status_update" }),
        );
    });

    it("manual 模式无需 Webhook 凭据并拒绝重复原始事件", async () => {
        const client = new WhatsAppClient({
            ...config,
            receive_mode: "manual",
            app_secret: undefined,
            webhook_verify_token: undefined,
        });
        const event = {
            object: "whatsapp_business_account" as const,
            entry: [{ id: "waba", changes: [] }],
        };
        await expect(client.ingest(event)).resolves.toMatchObject({ duplicate: false });
        await expect(client.ingest(event)).resolves.toMatchObject({ duplicate: true });
    });

    it("业务监听器失败时不提交去重状态，允许 Meta 重投递", async () => {
        const client = new WhatsAppClient({ ...config, receive_mode: "manual" });
        const event = {
            object: "whatsapp_business_account" as const,
            entry: [{ id: "waba", changes: [] }],
        };
        const failure = (): void => {
            throw new Error("downstream failed");
        };
        client.on("webhook", failure);
        await expect(client.ingest(event)).rejects.toThrow("downstream failed");
        client.off("webhook", failure);
        await expect(client.ingest(event)).resolves.toMatchObject({ duplicate: false });
    });

    it("一个事件视图失败后仍投递全部监听器与细粒度视图", async () => {
        const client = new WhatsAppClient({ ...config, receive_mode: "manual" });
        const secondWebhook = vi.fn();
        const change = vi.fn();
        const message = vi.fn();
        const status = vi.fn();
        client.on("webhook", () => {
            throw new Error("first webhook failed");
        });
        client.on("webhook", secondWebhook);
        client.on("change", change);
        client.on("message", message);
        client.on("status", status);
        const event = {
            object: "whatsapp_business_account" as const,
            entry: [
                {
                    id: "waba",
                    changes: [
                        {
                            field: "messages",
                            value: {
                                messages: [
                                    { id: "m1", from: "1", timestamp: "1", type: "text" as const },
                                ],
                                statuses: [
                                    {
                                        id: "m2",
                                        recipient_id: "1",
                                        timestamp: "2",
                                        status: "read" as const,
                                    },
                                ],
                            },
                        },
                    ],
                },
            ],
        };

        await expect(client.ingest(event)).rejects.toThrow("first webhook failed");
        expect(secondWebhook).toHaveBeenCalledOnce();
        expect(change).toHaveBeenCalledOnce();
        expect(message).toHaveBeenCalledOnce();
        expect(status).toHaveBeenCalledOnce();
    });

    it("等待全部生命周期监听器并在失败后允许重新启动", async () => {
        const fetcher = vi.fn<typeof fetch>().mockImplementation(
            async () =>
                new Response(JSON.stringify({ id: "phone" }), {
                    headers: { "content-type": "application/json" },
                }),
        );
        const client = new WhatsAppClient(config, fetcher);
        const laterReady = vi.fn();
        const failedReady = async (): Promise<void> => {
            await Promise.resolve();
            throw new Error("ready failed");
        };
        client.on("ready", failedReady);
        client.on("ready", laterReady);

        await expect(client.start()).rejects.toThrow("ready failed");
        expect(laterReady).toHaveBeenCalledOnce();
        client.off("ready", failedReady);
        await expect(client.start()).resolves.toMatchObject({ id: "phone" });
        expect(fetcher).toHaveBeenCalledTimes(2);

        let stopped = false;
        client.on("stop", async () => {
            await Promise.resolve();
            stopped = true;
        });
        await client.stop();
        expect(stopped).toBe(true);
    });

    it("等待异步监听器并合并同一载荷的并发重投", async () => {
        const client = new WhatsAppClient({ ...config, receive_mode: "manual" });
        const event = {
            object: "whatsapp_business_account" as const,
            entry: [{ id: "waba", changes: [] }],
        };
        let complete: (() => void) | undefined;
        const listener = vi.fn(() => new Promise<void>(resolve => (complete = resolve)));
        client.on("webhook", listener);

        const first = client.ingest(event);
        const retry = client.ingest(event);
        await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
        complete?.();

        await expect(Promise.all([first, retry])).resolves.toEqual([
            expect.objectContaining({ duplicate: false }),
            expect.objectContaining({ duplicate: false }),
        ]);
        await expect(client.ingest(event)).resolves.toMatchObject({ duplicate: true });
    });

    it("acceptHttp 接收标准 Request 并返回结构化响应", async () => {
        const client = new WhatsAppClient(config);
        const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
        const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
        const response = await client.acceptHttp(
            new Request("https://example.test/whatsapp", {
                method: "POST",
                body,
                headers: { "x-hub-signature-256": signature },
            }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            ok: true,
            accepted: 0,
            duplicate: false,
            changes: 0,
        });
        const verification = await client.acceptHttp(
            new Request(
                "https://example.test/whatsapp?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=42",
            ),
        );
        expect(verification.status).toBe(200);
        expect(await verification.text()).toBe("42");
    });

    it("业务处理失败返回 500，促使 Meta 重投而不是误报入参错误", async () => {
        const client = new WhatsAppClient(config);
        client.on("webhook", () => {
            throw new Error("downstream unavailable");
        });
        const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
        const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;

        const response = await client.acceptHttp(
            new Request("https://example.test/whatsapp", {
                method: "POST",
                body,
                headers: { "x-hub-signature-256": signature },
            }),
        );

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: "WHATSAPP_WEBHOOK_ERROR" },
        });
    });

    it("严格拒绝带凭据、路径或查询的 Graph API Base URL", () => {
        for (const apiBaseUrl of [
            "https://user:pass@graph.facebook.com",
            "https://graph.facebook.com/custom",
            "https://graph.facebook.com?token=x",
        ]) {
            expect(() => new WhatsAppClient({ ...config, api_base_url: apiBaseUrl })).toThrow(
                /HTTPS Origin/u,
            );
        }
    });

    it("固定 Graph 资源 ID 不能夹带路径", () => {
        expect(() => new WhatsAppClient({ ...config, phone_number_id: "phone/../other" })).toThrow(
            /单段 Graph 资源 ID/u,
        );
    });
});
