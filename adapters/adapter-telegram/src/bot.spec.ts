import { ErrorCategory } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import { TelegramBot } from "./bot.js";
import { TelegramError } from "./errors.js";
import type { Update } from "grammy/types";

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
            const deleteWebhook = vi
                .fn()
                .mockRejectedValueOnce(new Error("offline"))
                .mockResolvedValue(true);
            const getUpdates = vi.fn(
                (_options: unknown, signal?: AbortSignal) =>
                    new Promise<Update[]>(resolve => {
                        signal?.addEventListener("abort", () => resolve([]), { once: true });
                    }),
            );
            const nativeBot = {
                api: { deleteWebhook, getUpdates },
                botInfo: botInfo(),
                isInited: () => true,
                handleUpdate: vi.fn(),
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
            expect(getUpdates).toHaveBeenCalledOnce();
            expect(getUpdates).toHaveBeenCalledWith(
                expect.objectContaining({ timeout: 30, limit: 100 }),
                expect.any(AbortSignal),
            );
            expect(states).toEqual(["reconnecting", "connected"]);
            await bot.stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it("Webhook 删除失败时仍完成停止通知并清除活动状态", async () => {
        const deleteWebhook = vi.fn().mockRejectedValue(new Error("offline"));
        const nativeBot = {
            api: { deleteWebhook },
            botInfo: botInfo(),
            isInited: () => true,
        } as unknown as Bot;
        const bot = new TelegramBot({
            account_id: "bot",
            token: "1:token",
            receive_mode: "webhook",
            webhook: { url: "https://bot.example/hook", secret_token: "secret_1" },
        });
        Object.assign(
            bot as unknown as {
                initialized: boolean;
                running: boolean;
                bot: Bot;
            },
            { initialized: true, running: true, bot: nativeBot },
        );
        const stopped = vi.fn(async () => undefined);
        bot.on("stopped", stopped);

        await expect(bot.stop()).rejects.toMatchObject({
            code: "TELEGRAM_API_ERROR",
            method: "deleteWebhook",
        });
        await expect(bot.stop()).resolves.toBeUndefined();
        expect(deleteWebhook).toHaveBeenCalledOnce();
        expect(stopped).toHaveBeenCalledOnce();
    });

    it("polling 只在 Update 业务成功后推进 offset", async () => {
        vi.useFakeTimers();
        try {
            const updates = [{ update_id: 10 }, { update_id: 11 }] as Update[];
            const requestedOffsets: Array<number | undefined> = [];
            let request = 0;
            const getUpdates = vi.fn(
                (options: { offset?: number }, signal?: AbortSignal): Promise<Update[]> => {
                    requestedOffsets.push(options.offset);
                    request += 1;
                    if (request === 1) return Promise.resolve(updates);
                    if (request === 2) return Promise.resolve([updates[1]!]);
                    return new Promise(resolve => {
                        signal?.addEventListener("abort", () => resolve([]), { once: true });
                    });
                },
            );
            const nativeBot = {
                api: { deleteWebhook: vi.fn().mockResolvedValue(true), getUpdates },
                botInfo: botInfo(),
                isInited: () => true,
                handleUpdate: vi
                    .fn()
                    .mockResolvedValueOnce(undefined)
                    .mockRejectedValueOnce(new Error("consumer failed"))
                    .mockResolvedValue(undefined),
            } as unknown as Bot;
            const bot = new TelegramBot({ account_id: "bot", token: "1:token" });
            Object.assign(bot as unknown as { initialized: boolean; bot: Bot }, {
                initialized: true,
                bot: nativeBot,
            });
            await bot.start();
            await vi.advanceTimersByTimeAsync(2_000);
            await vi.runAllTicks();

            expect(requestedOffsets.slice(0, 3)).toEqual([undefined, 11, 12]);
            expect(nativeBot.handleUpdate).toHaveBeenCalledTimes(3);
            await bot.stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it("acceptHttp 校验 secret 并复用 grammY Update 入口", async () => {
        const bot = new TelegramBot({
            account_id: "bot",
            token: "1:token",
            receive_mode: "webhook",
            webhook: { url: "https://bot.example/hook", secret_token: "secret_1" },
        });
        const handleUpdate = vi.fn(async () => undefined);
        Object.assign(bot as unknown as { initialized: boolean; bot: Bot }, {
            initialized: true,
            bot: { isInited: () => true, handleUpdate } as unknown as Bot,
        });
        const request = new Request("https://bot.example/hook", {
            method: "POST",
            body: JSON.stringify({ update_id: 1 }),
            headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": "secret_1",
            },
        });

        const response = await bot.acceptHttp(request);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(handleUpdate).toHaveBeenCalledWith({ update_id: 1 });
        expect((await bot.acceptHttp(new Request("https://bot.example/hook"))).status).toBe(405);
    });

    it("异步业务更新监听器失败时不提交去重状态", async () => {
        const bot = new TelegramBot({ account_id: "bot", token: "1:token" });
        const update = { update_id: 2 } as Update;
        const dispatch = (value: Update): Promise<boolean> =>
            (
                bot as unknown as {
                    dispatchUpdate(update: Update): Promise<boolean>;
                }
            ).dispatchUpdate(value);
        const failure = vi.fn().mockRejectedValue(new Error("downstream failed"));
        bot.on("update", failure);
        await expect(dispatch(update)).rejects.toThrow("downstream failed");
        bot.off("update", failure);
        const listener = vi.fn();
        bot.on("update", listener);

        await expect(dispatch(update)).resolves.toBe(true);
        await expect(dispatch(update)).resolves.toBe(false);

        expect(listener).toHaveBeenCalledOnce();
    });

    it("合并同一 update_id 的并发投递并等待完整中间件链", async () => {
        const bot = new TelegramBot({ account_id: "bot", token: "1:token" });
        const update = { update_id: 3 } as Update;
        let release: (() => void) | undefined;
        const listener = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );
        const next = vi.fn(async () => undefined);
        bot.on("update", listener);
        const dispatch = (value: Update): Promise<boolean> =>
            (
                bot as unknown as {
                    dispatchUpdate(update: Update, next: () => Promise<void>): Promise<boolean>;
                }
            ).dispatchUpdate(value, next);

        const first = dispatch(update);
        const follower = dispatch(update);
        await Promise.resolve();
        expect(listener).toHaveBeenCalledOnce();
        release?.();

        await expect(Promise.all([first, follower])).resolves.toEqual([true, false]);
        expect(next).toHaveBeenCalledOnce();
    });

    it("grammY 错误边界记录后继续向 Webhook 传播投递失败", async () => {
        const bot = new TelegramBot({
            account_id: "bot",
            token: "1:token",
            receive_mode: "manual",
        });
        const nativeBot = new Bot("1:token", { botInfo: botInfo() });
        Object.assign(bot as unknown as { initialized: boolean; bot: Bot }, {
            initialized: true,
            bot: nativeBot,
        });
        (
            bot as unknown as {
                setupEventHandlers(): void;
            }
        ).setupEventHandlers();
        const failure = vi.fn().mockRejectedValue(new Error("protocol offline"));
        const clientError = vi.fn();
        bot.on("update", failure);
        bot.on("client_error", clientError);

        await expect(bot.ingest({ update_id: 4 })).rejects.toMatchObject({
            code: "TELEGRAM_UPDATE_HANDLER_ERROR",
        });
        expect(clientError).toHaveBeenCalledOnce();

        bot.off("update", failure);
        await expect(bot.ingest({ update_id: 4 })).resolves.toMatchObject({ update_id: 4 });
    });
});

function botInfo() {
    return {
        id: 1,
        is_bot: true as const,
        first_name: "Bot",
        username: "bot",
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
    };
}
