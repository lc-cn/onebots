import { describe, expect, it } from "vitest";
import { assertWechatClawbotConfig, resolveWechatClawbotReceiveMode } from "./config.js";

describe("微信 ClawBot 配置", () => {
    it("接受最小约定配置", () => {
        expect(() => assertWechatClawbotConfig({ account_id: "bot" })).not.toThrow();
        expect(() =>
            assertWechatClawbotConfig({ account_id: "bot", receive_mode: "manual" }),
        ).not.toThrow();
        expect(resolveWechatClawbotReceiveMode({})).toBe("polling");
        expect(resolveWechatClawbotReceiveMode({ receive_mode: "manual" })).toBe("manual");
    });

    it("拒绝未知接收模式", () => {
        expect(() =>
            assertWechatClawbotConfig({
                account_id: "bot",
                receive_mode: "webhook" as never,
            }),
        ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIG" }));
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
