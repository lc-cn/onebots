import { describe, expect, it } from "vitest";
import { parseZulipEventsResponse, parseZulipUserResponse } from "./responses.js";

describe("Zulip 响应校验", () => {
    it("只让完整用户响应进入 SDK 类型", () => {
        expect(
            parseZulipUserResponse({
                result: "success",
                msg: "",
                user: { user_id: 1, email: "bot@example.com", full_name: "Bot" },
            }).user.full_name,
        ).toBe("Bot");
        expect(() =>
            parseZulipUserResponse({ result: "success", msg: "", user: { user_id: "1" } }),
        ).toThrow("响应结构无效");
    });

    it("拒绝缺少稳定 ID 或类型的队列事件", () => {
        expect(() =>
            parseZulipEventsResponse({
                result: "success",
                msg: "",
                queue_id: "queue",
                events: [{ type: "message" }],
            }),
        ).toThrow("响应结构无效");
    });
});
