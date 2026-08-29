import { describe, expect, it } from "vitest";
import { wechatClawbotSchema } from "./index.js";

describe("微信 ClawBot 配置 Schema", () => {
    it("只暴露账号与长轮询调优字段", () => {
        expect(wechatClawbotSchema.account_id?.required).toBe(true);
        expect(wechatClawbotSchema.polling_timeout_ms?.min).toBe(1_000);
        expect(wechatClawbotSchema.polling_retry_initial_delay_ms?.min).toBe(100);
        expect(wechatClawbotSchema.polling_retry_max_delay_ms?.min).toBe(1_000);
        expect(wechatClawbotSchema).not.toHaveProperty("token");
        expect(wechatClawbotSchema).not.toHaveProperty("base_url");
    });
});
