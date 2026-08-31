import { describe, expect, it } from "vitest";
import { slackUserDisplayName } from "./users.js";

describe("Slack 用户模型", () => {
    it("优先使用官方 profile.display_name", () => {
        expect(
            slackUserDisplayName({
                id: "U1",
                name: "handle",
                real_name: "legacy",
                profile: { display_name: "Display", real_name: "Real" },
            }),
        ).toBe("Display");
    });

    it("兼容事件精简模型并最终回退到 handle", () => {
        expect(slackUserDisplayName({ id: "U1", name: "handle" })).toBe("handle");
    });
});
