import { listSupportedActions } from "onebots";
import { describe, expect, it } from "vitest";
import { WhatsAppAdapter } from "./adapter.js";
import { whatsAppCapabilities } from "./capabilities.js";
import { WHATSAPP_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("WhatsApp 能力清单", () => {
    it("所有平台动作均显式公开并有真实入口", () => {
        for (const action of WHATSAPP_PLATFORM_ACTIONS) {
            expect(whatsAppCapabilities.actions[action]?.support, action).toBe("native");
        }
        for (const action of listSupportedActions(whatsAppCapabilities)) {
            expect(WhatsAppAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
    });
});
