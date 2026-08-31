import { describe, expect, it } from "vitest";
import { wechatClawbotSchema } from "./index.js";

describe("微信 ClawBot 配置 Schema", () => {
    it("按接收模式组织账号与长轮询调优字段", () => {
        expect(wechatClawbotSchema.account_id?.required).toBe(true);
        expect(wechatClawbotSchema.receive_mode?.default).toBe("polling");
        expect(wechatClawbotSchema.receive_mode?.choices).toEqual([
            expect.objectContaining({ value: "polling" }),
            expect.objectContaining({ value: "manual" }),
        ]);
        expect(wechatClawbotSchema.polling_timeout_ms?.min).toBe(1_000);
        expect(wechatClawbotSchema.polling_retry_initial_delay_ms?.min).toBe(100);
        expect(wechatClawbotSchema.polling_retry_max_delay_ms?.min).toBe(1_000);
        expect(wechatClawbotSchema).not.toHaveProperty("token");
        expect(wechatClawbotSchema).not.toHaveProperty("base_url");
        for (const field of [
            "polling_timeout_ms",
            "polling_retry_initial_delay_ms",
            "polling_retry_max_delay_ms",
        ] as const) {
            expect(wechatClawbotSchema[field]?.ui?.visibleWhen).toEqual({
                path: "receive_mode",
                oneOf: ["polling"],
            });
        }
    });
});
