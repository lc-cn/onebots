import { listSupportedActions } from "onebots";
import { describe, expect, it } from "vitest";
import { QQAdapter } from "./adapter.js";
import { qqCapabilities } from "./capabilities.js";
import { QQ_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("QQ 能力清单", () => {
    it("所有平台动作均显式公开", () => {
        for (const action of QQ_PLATFORM_ACTIONS) {
            expect(qqCapabilities.actions[action]?.support, action).toBe("native");
        }
        expect(qqCapabilities.actions.send_typing?.scenes).toEqual(["private"]);
        expect(qqCapabilities.actions.mute_guild?.permissions).toEqual(["guild.manage"]);
        expect(qqCapabilities.actions.publish_bot_panel?.permissions).toEqual(["bot.ui.manage"]);
        expect(qqCapabilities.actions.start_c2c_stream).toMatchObject({
            scenes: ["private"],
            availability: "permission",
            permissions: ["c2c.stream_messages"],
        });
    });

    it("能力清单中的动作都有真实入口", () => {
        for (const action of listSupportedActions(qqCapabilities)) {
            expect(QQAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
    });

    it("只声明共享 Webhook 与正向 Gateway", () => {
        expect(qqCapabilities.transports.gateway?.mode).toBe("websocket");
        expect(qqCapabilities.transports.webhook?.mode).toBe("webhook");
    });
});
