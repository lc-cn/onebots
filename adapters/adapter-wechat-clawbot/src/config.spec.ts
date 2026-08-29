import { describe, expect, it } from "vitest";
import { assertWechatClawbotConfig } from "./config.js";

describe("微信 ClawBot 配置", () => {
    it("接受最小约定配置", () => {
        expect(() => assertWechatClawbotConfig({ account_id: "bot" })).not.toThrow();
    });

    it("在 IO 前拒绝非法超时和退避区间", () => {
        expect(() =>
            assertWechatClawbotConfig({ account_id: "bot", polling_timeout_ms: 999 }),
        ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIG" }));
        expect(() =>
            assertWechatClawbotConfig({
                account_id: "bot",
                polling_retry_initial_delay_ms: 2_000,
                polling_retry_max_delay_ms: 1_000,
            }),
        ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIG" }));
    });
});
