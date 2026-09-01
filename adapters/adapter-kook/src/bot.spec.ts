import { createCipheriv } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { KookBot } from "./bot.js";
import { KookApiError } from "./errors.js";
import { decryptWebhookMessage } from "./utils.js";

beforeEach(() => vi.useRealTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("KOOK Bot", () => {
    test("按官方格式解密 Webhook", () => {
        const encrypted = encryptWebhook('{"s":0}', "secret");
        expect(decryptWebhookMessage(encrypted, "secret")).toBe('{"s":0}');
    });

    test("Webhook challenge 校验 token", async () => {
        const bot = new KookBot({ account_id: "bot", token: "token", verify_token: "verify" });
        const ctx = {
            request: {
                body: {
                    s: 0,
                    d: {
                        type: 255,
                        channel_type: "WEBHOOK_CHALLENGE",
                        challenge: "challenge-value",
                        verify_token: "verify",
                    },
                },
            },
        } as never;
        await bot.handleWebhook(ctx, vi.fn());
        expect(ctx).toMatchObject({ body: { challenge: "challenge-value" } });
    });

    test("Webhook 按 sn 去重", async () => {
        const bot = new KookBot({ account_id: "bot", token: "token", verify_token: "verify" });
        const listener = vi.fn();
        bot.on("event", listener);
        const body = {
            s: 0,
            sn: 42,
            d: {
                type: 9,
                channel_type: "GROUP",
                target_id: "channel",
                author_id: "user",
                content: "hello",
                msg_id: "message",
                msg_timestamp: Date.now(),
                verify_token: "verify",
                extra: {},
            },
        };
        const first = { request: { body } } as never;
        const second = { request: { body } } as never;
        await bot.handleWebhook(first, vi.fn());
        await bot.handleWebhook(second, vi.fn());
        expect(listener).toHaveBeenCalledTimes(1);
        expect(second).toMatchObject({ body: { success: true, duplicate: true } });
    });

    test("Webhook 业务失败返回 500 且成功重投后才去重", async () => {
        const bot = new KookBot({ account_id: "bot", token: "token", verify_token: "verify" });
        let attempts = 0;
        bot.on("error", vi.fn());
        bot.on("event", () => {
            attempts += 1;
            if (attempts === 1) throw new Error("temporary failure");
        });
        const body = webhookSignal(77);
        const first = { request: { body } } as never;
        const second = { request: { body } } as never;
        const duplicate = { request: { body } } as never;

        await bot.handleWebhook(first, vi.fn());
        await bot.handleWebhook(second, vi.fn());
        await bot.handleWebhook(duplicate, vi.fn());

        expect(first).toMatchObject({
            status: 500,
            body: { code: "KOOK_EVENT_DELIVERY_FAILED" },
        });
        expect(second).toMatchObject({ status: 200, body: { success: true } });
        expect(duplicate).toMatchObject({ body: { success: true, duplicate: true } });
        expect(attempts).toBe(2);
    });

    test("REST 错误保留状态、平台错误码和路径", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ code: 40301, message: "无权限", data: {} }), {
                    status: 403,
                }),
            ),
        );
        const bot = new KookBot({ account_id: "bot", token: "token" });
        const error = await bot.callApi("/v3/guild/list").catch(value => value);
        expect(error).toBeInstanceOf(KookApiError);
        expect(error).toMatchObject({
            status: 403,
            platformCode: 40301,
            path: "/v3/guild/list",
        });
    });

    test("首次身份请求失败后继续恢复 Webhook 账号", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0);
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 0, data: { id: "bot", username: "KOOK" } }), {
                    status: 200,
                }),
            );
        vi.stubGlobal("fetch", fetchMock);
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "webhook",
            verify_token: "verify",
        });
        const ready = vi.fn();
        bot.on("ready", ready);

        await expect(bot.start()).rejects.toThrow("network down");
        await vi.advanceTimersByTimeAsync(800);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(ready).toHaveBeenCalledOnce();
        expect(bot.getCachedMe()).toMatchObject({ id: "bot" });
        await bot.stop();
    });

    test("manual 模式只初始化身份，不获取 Gateway", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ code: 0, data: { id: "bot", username: "KOOK" } }), {
                status: 200,
            }),
        );
        vi.stubGlobal("fetch", fetchMock);
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        const ready = vi.fn();
        bot.on("ready", ready);
        await bot.start();
        expect(ready).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v3/user/me");
        await bot.stop();
    });

    test("并发 start 共享同一次初始化并等待相同结果", async () => {
        let release: ((response: Response) => void) | undefined;
        const response = new Promise<Response>(resolve => {
            release = resolve;
        });
        const fetchMock = vi.fn().mockReturnValue(response);
        vi.stubGlobal("fetch", fetchMock);
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        const first = bot.start();
        const second = bot.start();
        const firstSettled = vi.fn();
        const secondSettled = vi.fn();
        void first.then(firstSettled);
        void second.then(secondSettled);

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        expect(firstSettled).not.toHaveBeenCalled();
        expect(secondSettled).not.toHaveBeenCalled();

        release?.(
            new Response(JSON.stringify({ code: 0, data: { id: "bot", username: "KOOK" } }), {
                status: 200,
            }),
        );
        await Promise.all([first, second]);
        expect(firstSettled).toHaveBeenCalledOnce();
        expect(secondSettled).toHaveBeenCalledOnce();
        await bot.stop();
    });

    test("启动取消会中止尚未完成的身份请求并拒绝迟到身份", async () => {
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
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        const controller = new AbortController();
        const starting = bot.start(controller.signal);
        await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));

        const reason = new Error("account startup timeout");
        controller.abort(reason);

        await expect(starting).rejects.toBe(reason);
        expect(requestSignal?.aborted).toBe(true);
        expect(bot.getCachedMe()).toBeNull();
    });

    test("启动取消会关闭尚未收到 HELLO 的 Gateway 连接", async () => {
        const socket = Object.assign(new EventEmitter(), {
            readyState: 0,
            close: vi.fn(),
            terminate: vi.fn(),
            send: vi.fn(),
        });
        socket.close.mockImplementation(() => {
            socket.readyState = 2;
        });
        const createSocket = vi.fn(() => socket as never);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 0, data: { id: "bot", username: "KOOK" } })),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        code: 0,
                        data: { url: "wss://gateway.example.test" },
                    }),
                ),
            );
        vi.stubGlobal("fetch", fetchMock);
        const bot = new KookBot({ account_id: "bot", token: "token" }, createSocket);
        const controller = new AbortController();
        const starting = bot.start(controller.signal);
        await vi.waitFor(() => expect(createSocket).toHaveBeenCalledOnce());

        const reason = new Error("account startup timeout");
        controller.abort(reason);

        await expect(starting).rejects.toBe(reason);
        expect(socket.close).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
        expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    });

    test("就绪后继续响应账号启动信号以支持协议启动回滚", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response(
                        JSON.stringify({ code: 0, data: { id: "bot", username: "KOOK" } }),
                    ),
                ),
        );
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        const stopped = vi.fn();
        bot.on("stopped", stopped);
        const controller = new AbortController();

        await bot.start(controller.signal);
        expect(bot.getCachedMe()).toMatchObject({ id: "bot" });
        controller.abort(new Error("protocol startup failed"));

        await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
        expect(bot.getCachedMe()).toBeNull();
    });

    test("等待异步生命周期监听器并在关闭失败后完成停止通知", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response(
                        JSON.stringify({ code: 0, data: { id: "bot", username: "KOOK" } }),
                    ),
                ),
        );
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        let releaseReady!: () => void;
        bot.on("ready", () => new Promise<void>(resolve => (releaseReady = resolve)));
        const starting = bot.start();
        await vi.waitFor(() => expect(releaseReady).toBeTypeOf("function"));
        let started = false;
        void starting.then(() => (started = true));
        expect(started).toBe(false);
        releaseReady();
        await starting;

        const stopped = vi.fn(async () => undefined);
        bot.on("stopped", stopped);
        Object.assign(bot as unknown as { socket: object }, {
            socket: {
                readyState: 1,
                close: vi.fn(() => {
                    throw new Error("close failed");
                }),
            },
        });

        await expect(bot.stop()).rejects.toMatchObject({ code: "KOOK_STOP_FAILED" });
        expect(stopped).toHaveBeenCalledOnce();
        await expect(bot.stop()).resolves.toBeUndefined();
    });

    test("manual ingest 复用 Gateway sn 保序器", async () => {
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        const listener = vi.fn();
        bot.on("event", listener);
        expect((await bot.ingest(gatewaySignal(10))).body).toEqual({ success: true });
        expect((await bot.ingest(gatewaySignal(12))).body).toEqual({
            success: true,
            buffered: true,
        });
        expect((await bot.ingest(gatewaySignal(11))).events?.map(event => event.msg_id)).toEqual([
            "message-11",
            "message-12",
        ]);
        expect(listener).toHaveBeenCalledTimes(3);

        await bot.resetIngest();
        expect((await bot.ingest(gatewaySignal(1))).event?.msg_id).toBe("message-1");
    });

    test("manual Gateway 投递失败时保留 sn 并允许原事件重投", async () => {
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        let attempts = 0;
        bot.on("event", () => {
            attempts += 1;
            if (attempts === 1) throw new Error("temporary failure");
        });

        await expect(bot.ingest(gatewaySignal(20))).rejects.toThrow("temporary failure");
        expect((await bot.ingest(gatewaySignal(20))).body).toEqual({ success: true });
        expect((await bot.ingest(gatewaySignal(20))).body).toEqual({
            success: true,
            duplicate: true,
        });
        expect(attempts).toBe(2);
    });

    test("manual Gateway 等待异步协议出口后才确认 sn", async () => {
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        let release: (() => void) | undefined;
        const listener = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );
        bot.on("event", listener);

        const first = bot.ingest(gatewaySignal(30));
        const duplicate = bot.ingest(gatewaySignal(30));
        await Promise.resolve();
        expect(listener).toHaveBeenCalledOnce();
        release?.();

        await expect(first).resolves.toMatchObject({ body: { success: true } });
        await expect(duplicate).resolves.toMatchObject({
            body: { success: true, duplicate: true },
        });
        expect(listener).toHaveBeenCalledOnce();
    });

    test("Gateway 投递失败使同批后续队列失效且不越过 sn", async () => {
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        const delivered: string[] = [];
        let fail = true;
        bot.on("event", async event => {
            delivered.push(event.msg_id);
            if (fail) {
                fail = false;
                throw new Error("protocol unavailable");
            }
        });

        const first = bot.ingest(gatewaySignal(40));
        const staleNext = bot.ingest(gatewaySignal(41));
        await expect(first).rejects.toThrow("protocol unavailable");
        await expect(staleNext).rejects.toMatchObject({
            code: "KOOK_GATEWAY_DELIVERY_STALE",
        });

        await expect(bot.ingest(gatewaySignal(40))).resolves.toMatchObject({
            body: { success: true },
        });
        await expect(bot.ingest(gatewaySignal(41))).resolves.toMatchObject({
            body: { success: true },
        });
        expect(delivered).toEqual(["message-40", "message-40", "message-41"]);
    });
});

function gatewaySignal(sn: number): Record<string, unknown> {
    return {
        s: 0,
        sn,
        d: {
            type: 9,
            channel_type: "GROUP",
            target_id: "channel",
            author_id: "user",
            content: `message ${sn}`,
            msg_id: `message-${sn}`,
            msg_timestamp: Date.now(),
            extra: {},
        },
    };
}

function webhookSignal(sn: number): Record<string, unknown> {
    return {
        ...gatewaySignal(sn),
        d: { ...(gatewaySignal(sn).d as Record<string, unknown>), verify_token: "verify" },
    };
}

function encryptWebhook(plain: string, encryptKey: string): string {
    const iv = Buffer.from("0123456789abcdef");
    const key = Buffer.alloc(32);
    Buffer.from(encryptKey).copy(key);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64");
    return Buffer.concat([iv, Buffer.from(encrypted)]).toString("base64");
}
