import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeishuBot } from "./bot.js";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("FeishuBot webhook", () => {
    it("解密 encrypt 事件后校验 verification token 并投递", async () => {
        const encryptKey = "encrypt-key";
        const event = {
            schema: "2.0",
            header: {
                token: "verify-token",
                event_id: "EV1",
                event_type: "im.message.recalled_v1",
                create_time: "1710000000000",
                app_id: "cli_1",
                tenant_key: "tenant",
            },
            event: { message_id: "om_1" },
        };
        const bot = new FeishuBot({
            account_id: "A1",
            app_id: "cli_1",
            app_secret: "secret",
            encrypt_key: encryptKey,
            verification_token: "verify-token",
        });
        const listener = vi.fn();
        bot.on("event", listener);
        const ctx = {
            request: { body: { encrypt: encrypt(JSON.stringify(event), encryptKey) } },
            body: undefined,
        };

        await bot.handleWebhook(ctx as never, vi.fn());

        expect(listener).toHaveBeenCalledWith(event, event);
        expect(ctx.body).toEqual({ code: 0 });
    });

    it("恢复长连接 EventDispatcher 展平的官方事件 envelope", () => {
        const bot = new FeishuBot({
            account_id: "A1",
            app_id: "cli_configured",
            app_secret: "secret",
        });
        const listener = vi.fn();
        bot.on("event", listener);

        bot["emitLongConnectionEvent"]("im.message.receive_v1", {
            schema: "2.0",
            event_id: "EV_LONG_1",
            event_type: "im.message.receive_v1",
            create_time: "1710000000123",
            app_id: "cli_actual",
            tenant_key: "tenant_actual",
            token: "verify-token",
            message: { message_id: "om_1", chat_id: "oc_1" },
            sender: { sender_id: { open_id: "ou_1" } },
        });

        const restored = {
            schema: "2.0",
            header: {
                event_id: "EV_LONG_1",
                event_type: "im.message.receive_v1",
                create_time: "1710000000123",
                app_id: "cli_actual",
                tenant_key: "tenant_actual",
                token: "verify-token",
            },
            event: {
                message: { message_id: "om_1", chat_id: "oc_1" },
                sender: { sender_id: { open_id: "ou_1" } },
            },
        };
        expect(listener).toHaveBeenCalledWith(restored, restored);
    });
});

describe("FeishuBot 目录分页", () => {
    it("遍历群成员 page_token 直到 has_more 结束", async () => {
        const bot = new FeishuBot({ account_id: "A1", app_id: "cli_1", app_secret: "secret" });
        const get = vi.spyOn(bot, "get");
        get.mockResolvedValueOnce({
            data: {
                code: 0,
                msg: "ok",
                data: {
                    items: [{ open_id: "ou_1", name: "Alice" }],
                    has_more: true,
                    page_token: "next",
                },
            },
        } as never);
        get.mockResolvedValueOnce({
            data: {
                code: 0,
                msg: "ok",
                data: { items: [{ open_id: "ou_2", name: "Bob" }], has_more: false },
            },
        } as never);

        await expect(bot.getChatMembers("oc_1")).resolves.toHaveLength(2);
        expect(get).toHaveBeenNthCalledWith(2, "/im/v1/chats/oc_1/members", {
            page_size: 100,
            page_token: "next",
        });
    });
});

describe("FeishuBot 请求与事件边界", () => {
    it("并发获取令牌只发送一次请求", async () => {
        const request = vi
            .fn()
            .mockResolvedValue(
                jsonResponse({ code: 0, msg: "ok", tenant_access_token: "token", expire: 7200 }),
            );
        vi.stubGlobal("fetch", request);
        const bot = createBot();

        await expect(
            Promise.all([bot.getTenantAccessToken(), bot.getTenantAccessToken()]),
        ).resolves.toEqual(["token", "token"]);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("令牌失效时只刷新一次并重放原请求", async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse({ code: 0, msg: "ok", tenant_access_token: "old", expire: 7200 }),
            )
            .mockResolvedValueOnce(jsonResponse({ code: 99991663, msg: "token invalid" }, 401))
            .mockResolvedValueOnce(
                jsonResponse({ code: 0, msg: "ok", tenant_access_token: "new", expire: 7200 }),
            )
            .mockResolvedValueOnce(jsonResponse({ code: 0, msg: "ok", data: { id: "ok" } }));
        vi.stubGlobal("fetch", request);
        const bot = createBot();

        await expect(bot.callApi("/im/v1/test")).resolves.toMatchObject({ code: 0 });
        expect(request).toHaveBeenCalledTimes(4);
        expect(request.mock.calls[3]?.[1]).toMatchObject({
            headers: expect.objectContaining({ Authorization: "Bearer new" }),
        });
    });

    it("拒绝无效响应和无 header 的事件", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json")));
        const bot = createBot();

        await expect(bot.callApi("/im/v1/test", { skipAuth: true })).rejects.toMatchObject({
            code: "FEISHU_INVALID_RESPONSE",
        });
        expect(() => bot.ingest({ event: {} })).toThrowError(
            expect.objectContaining({ code: "FEISHU_INVALID_EVENT" }),
        );
    });

    it("Webhook 非对象或无效事件返回 400", async () => {
        const bot = createBot();
        const nonObject = { request: { body: [] }, body: undefined, status: 0 };
        await bot.handleWebhook(nonObject as never, vi.fn());
        expect(nonObject).toMatchObject({ status: 400, body: { code: 1 } });

        const invalidEvent = { request: { body: { event: {} } }, body: undefined, status: 0 };
        await bot.handleWebhook(invalidEvent as never, vi.fn());
        expect(invalidEvent).toMatchObject({ status: 400, body: { code: 1 } });
    });

    it("隔离业务监听器异常并报告结构化错误", () => {
        const bot = createBot();
        const errorListener = vi.fn();
        bot.on("client_error", errorListener);
        bot.on("event", () => {
            throw new Error("listener failed");
        });

        bot.ingest({
            schema: "2.0",
            header: {
                event_id: "EV1",
                event_type: "custom",
                create_time: "1",
                app_id: "a",
                tenant_key: "t",
            },
            event: {},
        });
        expect(errorListener).toHaveBeenCalledWith(
            expect.objectContaining({ code: "FEISHU_LISTENER_FAILED" }),
        );
    });
});

function createBot(): FeishuBot {
    return new FeishuBot({ account_id: "A1", app_id: "cli_1", app_secret: "secret" });
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function encrypt(plaintext: string, encryptKey: string): string {
    const key = createHash("sha256").update(encryptKey).digest();
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([iv, cipher.update(plaintext), cipher.final()]).toString("base64");
}
