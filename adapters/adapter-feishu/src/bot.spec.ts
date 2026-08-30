import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCategory } from "onebots";
import { FeishuBot } from "./bot.js";
import { FeishuError } from "./errors.js";
import { FEISHU_LONG_CONNECTION_EVENT_TYPES } from "./long-connection.js";

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

    it("群成员详情验证真实成员身份", async () => {
        const bot = createBot();
        vi.spyOn(bot, "get").mockResolvedValue({
            data: {
                code: 0,
                msg: "ok",
                data: { items: [{ open_id: "ou_1", name: "Alice" }], has_more: false },
            },
        } as never);

        await expect(bot.getChatMember("oc_1", "ou_1")).resolves.toMatchObject({ name: "Alice" });
        await expect(bot.getChatMember("oc_1", "ou_missing")).rejects.toMatchObject({
            code: "FEISHU_GROUP_MEMBER_NOT_FOUND",
            category: ErrorCategory.RESOURCE,
        });
    });

    it("资源 ID 进入路径前会被编码", async () => {
        const bot = createBot();
        const get = vi.spyOn(bot, "get").mockResolvedValue({
            data: { code: 0, msg: "ok", data: { chat_id: "oc/1" } },
        } as never);

        await bot.getChatInfo("oc/1");

        expect(get).toHaveBeenCalledWith("/im/v1/chats/oc%2F1");
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

    it("监听器失败时允许同一事件重投，成功后才去重", () => {
        const bot = createBot();
        const listener = vi.fn().mockImplementationOnce(() => {
            throw new Error("listener failed");
        });
        bot.on("event", listener);
        const event = {
            schema: "2.0",
            header: {
                event_id: "EV1",
                event_type: "custom",
                create_time: "1",
                app_id: "a",
                tenant_key: "t",
            },
            event: {},
        };

        expect(() => bot.ingest(event)).toThrow("listener failed");
        expect(() => bot.ingest(event)).not.toThrow();
        bot.ingest(event);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("Webhook 业务处理失败返回 500 并允许上游重投", async () => {
        const bot = createBot();
        const listener = vi.fn().mockImplementationOnce(() => {
            throw new Error("dispatch failed");
        });
        bot.on("event", listener);
        const event = {
            schema: "2.0",
            header: {
                event_id: "EV_RETRY",
                event_type: "custom",
                create_time: "1",
                app_id: "a",
                tenant_key: "t",
            },
            event: {},
        };
        const first = { request: { body: event }, body: undefined, status: 0 };
        const second = { request: { body: event }, body: undefined, status: 0 };

        await bot.handleWebhook(first as never, vi.fn());
        await bot.handleWebhook(second as never, vi.fn());

        expect(first).toMatchObject({ status: 500, body: { code: 1 } });
        expect(second.body).toEqual({ code: 0 });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("并发启动共享完整初始化且只触发一次 ready", async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse({ code: 0, msg: "ok", tenant_access_token: "token", expire: 7200 }),
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    code: 0,
                    msg: "ok",
                    bot: { open_id: "ou_bot", app_name: "Bot" },
                }),
            );
        vi.stubGlobal("fetch", request);
        const bot = createBot();
        const ready = vi.fn();
        bot.on("ready", ready);

        await Promise.all([bot.start(), bot.start()]);

        expect(request).toHaveBeenCalledTimes(2);
        expect(ready).toHaveBeenCalledTimes(1);
    });

    it("stop 使尚未完成的启动代失效", async () => {
        let release!: (response: Response) => void;
        vi.stubGlobal(
            "fetch",
            vi.fn(
                () =>
                    new Promise<Response>(resolve => {
                        release = resolve;
                    }),
            ),
        );
        const bot = createBot();
        const ready = vi.fn();
        bot.on("ready", ready);

        const starting = bot.start();
        await bot.stop();
        release(jsonResponse({ code: 0, msg: "ok", tenant_access_token: "token", expire: 7200 }));
        await starting;

        expect(ready).not.toHaveBeenCalled();
    });

    it("平台错误保留业务码并继承统一错误分类", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(jsonResponse({ code: 12345, msg: "失败" })),
        );
        const bot = createBot();

        const error = await bot
            .callApi("/im/v1/test", { skipAuth: true })
            .catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(FeishuError);
        expect(error).toMatchObject({
            code: "FEISHU_API_ERROR",
            category: ErrorCategory.ADAPTER,
            platformCode: 12345,
        });
    });

    it("拒绝可能泄露应用凭据的不安全 endpoint", () => {
        expect(
            () =>
                new FeishuBot({
                    account_id: "A1",
                    app_id: "cli_1",
                    app_secret: "secret",
                    endpoint: "http://example.com/open-apis?target=evil",
                }),
        ).toThrowError(
            expect.objectContaining({
                code: "FEISHU_ENDPOINT_INVALID",
                category: ErrorCategory.VALIDATION,
            }),
        );
    });

    it("长连接客户端未注入 SDK logger 时不会伪装 ready", async () => {
        const bot = new FeishuBot({ account_id: "A1", app_id: "cli_1", app_secret: "secret" });

        await expect(bot.start()).rejects.toMatchObject({
            code: "FEISHU_LONG_CONNECTION_NOT_CONFIGURED",
            category: ErrorCategory.CONFIG,
        });
    });

    it("注册官方 SDK 当前声明的完整 IM 事件集合", () => {
        expect(FEISHU_LONG_CONNECTION_EVENT_TYPES).toEqual([
            "im.chat.access_event.bot_p2p_chat_entered_v1",
            "im.chat.disbanded_v1",
            "im.chat.member.bot.added_v1",
            "im.chat.member.bot.deleted_v1",
            "im.chat.member.user.added_v1",
            "im.chat.member.user.deleted_v1",
            "im.chat.member.user.withdrawn_v1",
            "im.chat.updated_v1",
            "im.message.message_read_v1",
            "im.message.reaction.created_v1",
            "im.message.reaction.deleted_v1",
            "im.message.recalled_v1",
            "im.message.receive_v1",
            "application.bot.menu_v6",
        ]);
    });
});

function createBot(): FeishuBot {
    return new FeishuBot({
        account_id: "A1",
        app_id: "cli_1",
        app_secret: "secret",
        receive_mode: "webhook",
    });
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
