import { describe, expect, it } from "vitest";
import type { ValidationRule } from "onebots";
import { telegramSchema } from "./index.js";
import { TELEGRAM_UPDATE_TYPES } from "./types.js";

const ruleAt = (...path: string[]): ValidationRule => {
    let current: unknown = telegramSchema;
    for (const key of path) current = (current as Record<string, unknown>)[key];
    return current as ValidationRule;
};

describe("Telegram 配置 Schema", () => {
    it("用接收模式动态隔离 Webhook 与长轮询字段", () => {
        expect(ruleAt("receive_mode").default).toBe("polling");
        expect(ruleAt("webhook", "url").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook"],
        });
        expect(ruleAt("polling", "timeout").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["polling"],
        });
    });

    it("所有 Update 订阅均使用可增减的受限选项列表", () => {
        for (const mode of ["webhook", "polling"] as const) {
            const rule = ruleAt(mode, "allowed_updates");
            expect(rule.ui?.widget).toBe("choice-list");
            expect(rule.choices?.map(choice => choice.value)).toEqual(TELEGRAM_UPDATE_TYPES);
        }
    });
});
