import { ErrorCategory } from "onebots";
import { describe, expect, it } from "vitest";
import { TelegramError } from "./errors.js";

describe("TelegramError", () => {
    it("保留 Bot API 限流和迁移参数", () => {
        const error = TelegramError.wrap(
            {
                error: {
                    message: "Too Many Requests",
                    error_code: 429,
                    parameters: { retry_after: 3, migrate_to_chat_id: -100123 },
                },
            },
            "TELEGRAM_SEND_FAILED",
            "sendMessage",
        );

        expect(error).toMatchObject({
            code: "TELEGRAM_SEND_FAILED",
            category: ErrorCategory.NETWORK,
            method: "sendMessage",
            platformCode: 429,
            retryAfter: 3,
            migrateToChatId: -100123,
        });
    });

    it("为参数错误提供稳定错误码", () => {
        const error = TelegramError.invalid("bad", "TELEGRAM_PARAM_INVALID", { name: "id" });
        expect(error.category).toBe(ErrorCategory.VALIDATION);
        expect(error.code).toBe("TELEGRAM_PARAM_INVALID");
    });
});
