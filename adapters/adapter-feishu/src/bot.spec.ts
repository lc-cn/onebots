import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCategory } from "onebots";
import { FeishuBot } from "./bot.js";
import { FeishuError } from "./errors.js";
import {
    FEISHU_LONG_CONNECTION_EVENT_TYPES,
    restoreLongConnectionEnvelope,
} from "./long-connection.js";

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

        const response = await bot.ingestHttp({
            method: "POST",
            body: { encrypt: encrypt(JSON.stringify(event), encryptKey) },
        });

        expect(listener).toHaveBeenCalledWith(event, event);
        expect(response).toMatchObject({ status: 200, body: { code: 0 }, event });
    });

    it("恢复长连接 EventDispatcher 展平的官方事件 envelope", async () => {
        const bot = new FeishuBot({
            account_id: "A1",
            app_id: "cli_configured",
            app_secret: "secret",
        });
        const listener = vi.fn();
        bot.on("event", listener);

        await bot["emitLongConnectionEvent"]("im.message.receive_v1", {
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

    it("缺少 event_id 时按规范化载荷生成稳定身份", () => {
        const first = restoreLongConnectionEnvelope(
            "im.message.receive_v1",
            { message: { chat_id: "oc_1", message_id: "om_1" }, tenant_key: "tenant" },
            "cli_1",
        );
        const reordered = restoreLongConnectionEnvelope(
            "im.message.receive_v1",
            { tenant_key: "tenant", message: { message_id: "om_1", chat_id: "oc_1" } },
            "cli_1",
        );

        expect(first.header.event_id).toMatch(/^im\.message\.receive_v1:sha256:[a-f0-9]{64}$/);
        expect(reordered.header.event_id).toBe(first.header.event_id);
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
        await expect(bot.ingest({ event: {} })).rejects.toThrowError(
            expect.objectContaining({ code: "FEISHU_INVALID_EVENT" }),
        );
    });

    it("Webhook 非对象或无效事件返回 400", async () => {
        const bot = createBot();
        await expect(bot.ingestHttp({ method: "POST", body: [] })).resolves.toMatchObject({
            status: 400,
            body: { code: 1 },
        });

        const context = {
            method: "POST",
            request: { body: { event: {} } },
            set: vi.fn(),
            body: undefined as unknown,
            status: 0,
        };
        await bot.acceptHttp(context);
        expect(context).toMatchObject({ status: 400, body: { code: 1 } });
        expect(context.set).toHaveBeenCalledWith("Content-Type", "application/json; charset=utf-8");
    });

    it("异步监听器失败时允许同一事件重投，成功后才去重", async () => {
        const bot = createBot();
        const listener = vi.fn().mockRejectedValueOnce(new Error("listener failed"));
        const independentListener = vi.fn();
        bot.on("event", listener);
        bot.on("event", independentListener);
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

        await expect(bot.ingest(event)).rejects.toThrow("listener failed");
        await expect(bot.ingest(event)).resolves.toEqual(event);
        await expect(bot.ingest(event)).resolves.toBeUndefined();
        expect(listener).toHaveBeenCalledTimes(2);
        expect(independentListener).toHaveBeenCalledTimes(2);
    });

    it("合并同一事件的并发重投并等待业务监听器", async () => {
        const bot = createBot();
        let release: (() => void) | undefined;
        const listener = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );
        bot.on("event", listener);
        const event = {
            schema: "2.0",
            header: {
                event_id: "EV_CONCURRENT",
                event_type: "custom",
                create_time: "1",
                app_id: "a",
                tenant_key: "t",
            },
            event: {},
        };

        const first = bot.ingest(event);
        const second = bot.ingest(event);
        expect(listener).toHaveBeenCalledOnce();
        release?.();
        await Promise.all([first, second]);
        expect(listener).toHaveBeenCalledOnce();
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
        const first = await bot.ingestHttp({ method: "POST", body: event });
        const second = await bot.ingestHttp({ method: "POST", body: event });

        expect(first).toMatchObject({ status: 500, body: { code: 1 } });
        expect(second).toMatchObject({ status: 200, body: { code: 0 } });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("Fetch Host 返回标准响应并拒绝非 POST 方法", async () => {
        const bot = createBot();
        const event = {
            schema: "2.0",
            header: {
                event_id: "EV_FETCH",
                event_type: "custom",
                create_time: "1",
                app_id: "a",
                tenant_key: "t",
            },
            event: {},
        };
        const response = await bot.acceptHttp(
            new Request("https://example.test/feishu", {
                method: "POST",
                body: JSON.stringify(event),
                headers: { "content-type": "application/json" },
            }),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
        expect(await response.json()).toEqual({ code: 0 });

        const rejected = await bot.acceptHttp(new Request("https://example.test/feishu"));
        expect(rejected.status).toBe(405);
        expect(rejected.headers.get("allow")).toBe("POST");
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
        let requestSignal: AbortSignal | undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn(
                (_url: string | URL | Request, init?: RequestInit) =>
                    new Promise<Response>(resolve => {
                        requestSignal = init?.signal ?? undefined;
                        release = resolve;
                    }),
            ),
        );
        const bot = createBot();
        const ready = vi.fn();
        bot.on("ready", ready);

        const starting = bot.start();
        await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
        await bot.stop();
        release(jsonResponse({ code: 0, msg: "ok", tenant_access_token: "token", expire: 7200 }));
        await expect(starting).rejects.toMatchObject({ code: "FEISHU_START_CANCELLED" });

        expect(requestSignal?.aborted).toBe(true);
        expect(ready).not.toHaveBeenCalled();
    });

    it("账号启动取消会中止令牌请求并保留取消原因", async () => {
        let requestSignal: AbortSignal | undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn((_url: string | URL | Request, init?: RequestInit) => {
                requestSignal = init?.signal ?? undefined;
                return new Promise<Response>((_resolve, reject) => {
                    requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
                        once: true,
                    });
                });
            }),
        );
        const bot = createBot();
        const controller = new AbortController();
        const starting = bot.start(controller.signal);
        await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));

        const reason = new Error("account startup timeout");
        controller.abort(reason);

        await expect(starting).rejects.toBe(reason);
        expect(requestSignal?.aborted).toBe(true);
        expect(bot.getCachedMe()).toBeNull();
    });

    it("账号启动取消会强制关闭尚未完成的官方长连接", async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse({
                    code: 0,
                    msg: "ok",
                    tenant_access_token: "token",
                    expire: 7200,
                }),
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    code: 0,
                    msg: "ok",
                    bot: { open_id: "ou_bot", app_name: "Bot" },
                }),
            );
        vi.stubGlobal("fetch", request);
        let rejectStart!: (error: Error) => void;
        const wsClient = {
            start: vi.fn(
                () =>
                    new Promise<void>((_resolve, reject) => {
                        rejectStart = reject;
                    }),
            ),
            close: vi.fn(() => rejectStart(new Error("connection closed"))),
        };
        const bot = new FeishuBot({
            account_id: "A1",
            app_id: "cli_1",
            app_secret: "secret",
        });
        Object.assign(bot as unknown as Record<string, unknown>, {
            sdkLogger: {},
            wsClient,
            eventDispatcher: {},
        });
        const controller = new AbortController();
        const starting = bot.start(controller.signal);
        await vi.waitFor(() => expect(wsClient.start).toHaveBeenCalledOnce());

        const reason = new Error("account startup timeout");
        controller.abort(reason);

        await expect(starting).rejects.toBe(reason);
        expect(wsClient.close).toHaveBeenCalledWith({ force: true });
        expect(request.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
        expect(request.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
        expect(request.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    });

    it("身份就绪后继续响应账号信号以支持协议启动回滚", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(
                    jsonResponse({
                        code: 0,
                        msg: "ok",
                        tenant_access_token: "token",
                        expire: 7200,
                    }),
                )
                .mockResolvedValueOnce(
                    jsonResponse({
                        code: 0,
                        msg: "ok",
                        bot: { open_id: "ou_bot", app_name: "Bot" },
                    }),
                ),
        );
        const bot = createBot();
        const stopped = vi.fn();
        bot.on("stopped", stopped);
        const controller = new AbortController();

        await bot.start(controller.signal);
        controller.abort(new Error("protocol startup failed"));

        await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
    });

    it("长连接关闭失败时仍完成异步停止通知", async () => {
        const bot = createBot();
        const close = vi.fn(() => {
            throw new Error("close failed");
        });
        Object.assign(
            bot as unknown as {
                running: boolean;
                wsClient: { close(options: { force: boolean }): void };
            },
            { running: true, wsClient: { close } },
        );
        const stopped = vi.fn(async () => undefined);
        bot.on("stopped", stopped);

        await expect(bot.stop()).rejects.toMatchObject({ code: "FEISHU_STOP_FAILED" });
        expect(close).toHaveBeenCalledWith({ force: true });
        expect(stopped).toHaveBeenCalledOnce();
        await expect(bot.stop()).resolves.toBeUndefined();
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
