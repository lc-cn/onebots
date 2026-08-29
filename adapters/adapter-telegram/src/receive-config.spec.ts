import { describe, expect, it } from "vitest";
import { resolveTelegramReceiveConfig } from "./receive-config.js";

describe("resolveTelegramReceiveConfig", () => {
    it("默认生成完整订阅的长轮询计划并保留参数", () => {
        const receive = resolveTelegramReceiveConfig({
            account_id: "bot",
            token: "token",
            polling: { timeout: 25, limit: 50, allowed_updates: ["message", "message"] },
        });

        expect(receive).toEqual({
            mode: "polling",
            options: { timeout: 25, limit: 50, allowed_updates: ["message"] },
        });
    });

    it("将表单空选择闭合为完整订阅而不是 Telegram 的缩减默认集", () => {
        const receive = resolveTelegramReceiveConfig({
            account_id: "bot",
            token: "token",
            polling: { allowed_updates: [] },
        });

        expect(receive.mode).toBe("polling");
        if (receive.mode !== "polling") throw new Error("expected polling");
        expect(receive.options.allowed_updates).toContain("chat_member");
        expect(receive.options.allowed_updates).toContain("message_reaction");
    });

    it("闭合 Webhook URL、secret 与订阅", () => {
        expect(
            resolveTelegramReceiveConfig({
                account_id: "bot",
                token: "token",
                receive_mode: "webhook",
                webhook: {
                    url: "https://bot.example/telegram/webhook",
                    secret_token: "valid_secret-1",
                    allowed_updates: ["callback_query"],
                },
            }),
        ).toEqual({
            mode: "webhook",
            url: "https://bot.example/telegram/webhook",
            secretToken: "valid_secret-1",
            allowedUpdates: ["callback_query"],
        });
    });

    it.each([
        [{ receive_mode: "webhook", webhook: { url: "http://bot.example/hook" } }, "HTTPS"],
        [
            { receive_mode: "webhook", webhook: { url: "https://bot.example", secret_token: "!" } },
            "secret_token",
        ],
        [{ polling: { timeout: 0 } }, "polling.timeout"],
        [{ polling: { limit: 101 } }, "polling.limit"],
        [{ polling: { allowed_updates: ["future_update"] } }, "future_update"],
    ])("拒绝无效接收配置 %#", (partial, message) => {
        expect(() =>
            resolveTelegramReceiveConfig({
                account_id: "bot",
                token: "token",
                ...partial,
            } as never),
        ).toThrow(message);
    });
});
