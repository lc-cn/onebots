import { describe, expect, it } from "vitest";
import { listSupportedActions } from "onebots";
import { SlackAdapter } from "./adapter.js";
import { slackCapabilities } from "./capabilities.js";
import { SLACK_PLATFORM_ACTIONS } from "./platform-actions.js";

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

    it("平台动作注册表完整驱动能力发现", () => {
        for (const action of SLACK_PLATFORM_ACTIONS) {
            expect(slackCapabilities.actions[action]?.support, action).toBe("native");
        }
        expect(slackCapabilities.actions.open_view?.availability).toBe("context");
        expect(slackCapabilities.actions.update_user_group_users?.support).toBe("native");
    });
});
