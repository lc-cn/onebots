import { describe, expect, it, vi } from "vitest";
import { DiscordBot } from "./bot.js";

describe("DiscordBot startup cancellation", () => {
    it("身份就绪后仍保留账号启动信号以覆盖后续协议阶段", async () => {
        const bot = new DiscordBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        vi.spyOn(bot.getREST(), "getCurrentUser").mockResolvedValue({
            id: "U1",
            username: "Bot",
        });
        const stopped = vi.fn();
        bot.on("stopped", stopped);
        const controller = new AbortController();

        await bot.start(controller.signal);
        controller.abort();

        await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
        expect(bot.isReady()).toBe(false);
    });

    it("手动接入的身份请求迟到时不再发布 ready", async () => {
        const bot = new DiscordBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        let resolveUser: ((value: { id: string; username: string }) => void) | undefined;
        const getCurrentUser = vi.spyOn(bot.getREST(), "getCurrentUser").mockImplementation(
            () =>
                new Promise(resolve => {
                    resolveUser = resolve;
                }),
        );
        const ready = vi.fn();
        bot.on("ready", ready);
        const controller = new AbortController();

        const starting = bot.start(controller.signal);
        const rejected = expect(starting).rejects.toMatchObject({ name: "AbortError" });
        await vi.waitFor(() => expect(getCurrentUser).toHaveBeenCalledOnce());
        controller.abort();
        resolveUser?.({ id: "U1", username: "Bot" });

        await rejected;
        expect(ready).not.toHaveBeenCalled();
        expect(bot.isReady()).toBe(false);
        expect(bot.getBotUser()).toBeNull();
    });
});
