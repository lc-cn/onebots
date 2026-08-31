import { describe, expect, it } from "vitest";
import { createMilkySignature, verifyMilkySignature, verifyMilkyToken } from "./auth.js";

describe("Milky 鉴权边界", () => {
    it("在启用凭据时拒绝缺失或不匹配的 token", () => {
        expect(verifyMilkyToken(undefined, undefined)).toBe(true);
        expect(verifyMilkyToken("secret", undefined)).toBe(false);
        expect(verifyMilkyToken("secret", "secret")).toBe(true);
    });

    it("使用恒定时间比较验证 WebHook HMAC", () => {
        const body = '{"event_type":"bot_offline"}';
        const signature = createMilkySignature("secret", body);
        expect(verifyMilkySignature("secret", body, signature)).toBe(true);
        expect(verifyMilkySignature("secret", body, `${signature}0`)).toBe(false);
        expect(verifyMilkySignature("secret", body, undefined)).toBe(false);
    });
});
