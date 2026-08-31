import { describe, expect, it } from "vitest";
import { weComKfCapabilities } from "./capabilities.js";
import { WECOM_KF_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("微信客服能力清单", () => {
    it("所有原生动作都公开且不声明群聊", () => {
        for (const action of WECOM_KF_PLATFORM_ACTIONS)
            expect(weComKfCapabilities.actions[action]?.support).toBe("native");
        expect(weComKfCapabilities.actions.send_message?.scenes).toEqual(["private", "direct"]);
        expect(weComKfCapabilities.actions.get_group_list).toBeUndefined();
    });
});
