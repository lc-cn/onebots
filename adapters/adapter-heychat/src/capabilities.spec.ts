import { describe, expect, it } from "vitest";
import { listSupportedActions } from "onebots";
import { HeychatAdapter } from "./adapter.js";
import { heychatCapabilities } from "./capabilities.js";
import { HEYCHAT_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("黑盒语音能力清单", () => {
    it("所有平台动作均显式公开", () => {
        for (const action of HEYCHAT_PLATFORM_ACTIONS) {
            expect(heychatCapabilities.actions[action]?.support).toBe("native");
        }
    });

    it("能力清单中的动作都有真实适配器入口", () => {
        for (const action of listSupportedActions(heychatCapabilities)) {
            expect(HeychatAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
    });

    it("只声明真实的正向 WebSocket 与官方事件", () => {
        expect(heychatCapabilities.transports.websocket?.support).toBe("native");
        expect(heychatCapabilities.transports.webhook).toBeUndefined();
        expect(heychatCapabilities.events.message?.note).toContain("type=50");
        expect(heychatCapabilities.segments.heychat_message?.support).toBe("native");
    });
});
