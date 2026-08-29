import { createCipheriv } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { KookApiError, KookBot } from "./bot.js";
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
        const bot = new KookBot({ account_id: "bot", token: "token" });
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
        expect(error).toMatchObject({ status: 403, code: 40301, path: "/v3/guild/list" });
    });

    test("首次身份请求失败后继续恢复 Webhook 账号", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0);
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ code: 0, data: { id: "bot", username: "KOOK" } }),
                    { status: 200 },
                ),
            );
        vi.stubGlobal("fetch", fetchMock);
        const bot = new KookBot({
            account_id: "bot",
            token: "token",
            receive_mode: "webhook",
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
});

function encryptWebhook(plain: string, encryptKey: string): string {
    const iv = Buffer.from("0123456789abcdef");
    const key = Buffer.alloc(32);
    Buffer.from(encryptKey).copy(key);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64");
    return Buffer.concat([iv, Buffer.from(encrypted)]).toString("base64");
}
