import { createCipheriv } from "node:crypto";
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

    test("manual ingest 复用 Gateway sn 保序器", () => {
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        const listener = vi.fn();
        bot.on("event", listener);
        expect(bot.ingest(gatewaySignal(10)).body).toEqual({ success: true });
        expect(bot.ingest(gatewaySignal(12)).body).toEqual({ success: true, buffered: true });
        expect(bot.ingest(gatewaySignal(11)).events?.map(event => event.msg_id)).toEqual([
            "message-11",
            "message-12",
        ]);
        expect(listener).toHaveBeenCalledTimes(3);

        bot.resetIngest();
        expect(bot.ingest(gatewaySignal(1)).event?.msg_id).toBe("message-1");
    });

    test("manual Gateway 投递失败时保留 sn 并允许原事件重投", () => {
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

        expect(() => bot.ingest(gatewaySignal(20))).toThrow("temporary failure");
        expect(bot.ingest(gatewaySignal(20)).body).toEqual({ success: true });
        expect(bot.ingest(gatewaySignal(20)).body).toEqual({ success: true, duplicate: true });
        expect(attempts).toBe(2);
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
