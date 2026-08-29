import { ErrorCategory } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { TelegramBot } from "./bot.js";
import { TelegramError } from "./errors.js";
import type { Bot } from "grammy";

describe("TelegramBot 边界", () => {
    it("在建立 grammY 客户端前拒绝空 token", () => {
        expect(() => new TelegramBot({ account_id: "bot", token: "" })).toThrowError(
            expect.objectContaining({ code: "TELEGRAM_TOKEN_REQUIRED" }),
        );
    });

    it("把原生 API 失败闭合为结构化错误", async () => {
        const bot = new TelegramBot({ account_id: "bot", token: "1:token" });
        await expect(
            bot.callApi("sendMessage", async () => {
                throw new Error("network down");
            }),
        ).rejects.toMatchObject({
            name: "TelegramError",
            code: "TELEGRAM_API_ERROR",
            method: "sendMessage",
        } satisfies Partial<TelegramError>);
    });

    it("Webhook secret 必填且精确匹配", () => {
        const bot = new TelegramBot({
            account_id: "bot",
            token: "1:token",
            receive_mode: "webhook",
            webhook: { url: "https://bot.example/hook", secret_token: "secret_1" },
        });
        expect(bot.verifyWebhookSecret("secret_1")).toBe(true);
        expect(bot.verifyWebhookSecret("secret_2")).toBe(false);
        expect(bot.verifyWebhookSecret(undefined)).toBe(false);
    });

    it("配置错误使用 CONFIG 分类", () => {
        try {
            new TelegramBot({ account_id: "bot", token: "" });
        } catch (error) {
            expect(error).toBeInstanceOf(TelegramError);
            expect((error as TelegramError).category).toBe(ErrorCategory.CONFIG);
        }
    });

    it("拒绝代理工厂无法表达的协议", () => {
        expect(
            () =>
                new TelegramBot({
                    account_id: "bot",
                    token: "1:token",
                    proxy: { url: "ftp://proxy.example" },
                }),
        ).toThrowError(expect.objectContaining({ code: "TELEGRAM_PROXY_URL_INVALID" }));
    });

    it("polling 初次网络失败后仍会重试并恢复在线", async () => {
        vi.useFakeTimers();
        try {
            let stopPolling!: () => void;
            const deleteWebhook = vi
                .fn()
                .mockRejectedValueOnce(new Error("offline"))
                .mockResolvedValue(true);
            const start = vi.fn(async (options: Parameters<Bot["start"]>[0]) => {
                await options?.onStart?.({
                    id: 1,
                    is_bot: true,
                    first_name: "Bot",
                    username: "bot",
                    can_join_groups: true,
                    can_read_all_group_messages: false,
                    supports_inline_queries: false,
                    can_connect_to_business: false,
                    has_main_web_app: false,
                });
                await new Promise<void>(resolve => {
                    stopPolling = resolve;
                });
            });
            const nativeBot = {
                api: { deleteWebhook },
                start,
                stop: async () => stopPolling(),
                isRunning: () => start.mock.calls.length > 0,
            } as unknown as Bot;
            const bot = new TelegramBot({ account_id: "bot", token: "1:token" });
            Object.assign(bot as unknown as { initialized: boolean; bot: Bot }, {
                initialized: true,
                bot: nativeBot,
            });
            const states: string[] = [];
            bot.on("transport_state", state => states.push(state));

            await bot.start();
            await vi.advanceTimersByTimeAsync(2_000);

            expect(deleteWebhook).toHaveBeenCalledTimes(2);
            expect(start).toHaveBeenCalledOnce();
            expect(states).toEqual(["reconnecting", "connected"]);
            await bot.stop();
        } finally {
            vi.useRealTimers();
        }
    });
});
