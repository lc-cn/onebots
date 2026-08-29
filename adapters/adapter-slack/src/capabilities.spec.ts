import { describe, expect, it } from "vitest";
import { listSupportedActions } from "onebots";
import { SlackAdapter } from "./adapter.js";
import { slackCapabilities } from "./capabilities.js";

describe("Slack 能力清单", () => {
    it("使用 canonical 频道模型，不再投影为群组", () => {
        expect(slackCapabilities.actions.get_group_list).toBeUndefined();
        expect(slackCapabilities.actions.get_group_member_list).toBeUndefined();
        expect(slackCapabilities.actions.get_channel_list?.support).toBe("native");
        expect(slackCapabilities.actions.get_channel_member_list?.support).toBe("native");
        expect(SlackAdapter.prototype.isActionImplemented("get_group_list")).toBe(false);
    });

    it("所有声明动作均有真实入口", () => {
        for (const action of listSupportedActions(slackCapabilities)) {
            expect(SlackAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
    });
});
