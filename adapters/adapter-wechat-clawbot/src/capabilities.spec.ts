import { listSupportedActions } from "onebots";
import { describe, expect, it } from "vitest";
import { WechatClawbotAdapter } from "./adapter.js";
import { wechatClawbotCapabilities } from "./capabilities.js";
import { WECHAT_CLAWBOT_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("微信 ClawBot 能力清单", () => {
    it("公开动作均有真实入口且不伪造好友目录", () => {
        for (const action of WECHAT_CLAWBOT_PLATFORM_ACTIONS) {
            expect(wechatClawbotCapabilities.actions[action]?.support, action).toBe("native");
        }
        for (const action of listSupportedActions(wechatClawbotCapabilities)) {
            expect(WechatClawbotAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
        expect(wechatClawbotCapabilities.actions.get_friend_list).toBeUndefined();
    });

    it("准确声明 context_token 与接收专用语音", () => {
        expect(wechatClawbotCapabilities.actions.send_message?.availability).toBe("context");
        expect(wechatClawbotCapabilities.actions.can_send_image?.support).toBe("native");
        expect(wechatClawbotCapabilities.actions.can_send_record?.support).toBe("native");
        expect(wechatClawbotCapabilities.segments.audio?.direction).toBe("receive");
        expect(wechatClawbotCapabilities.transports.ilink?.mode).toBe("polling");
    });
});
