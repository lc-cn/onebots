import { describe, expect, it } from "vitest";
import { describeFacebookMessengerCapabilities } from "./capabilities.js";

describe("Facebook Messenger 动态能力", () => {
    it("按 subscribed_fields、event_types 与 manual 模式收敛事件和 transport", () => {
        const manifest = describeFacebookMessengerCapabilities({
            receive_mode: "manual",
            subscribed_fields: ["messages", "message_reads"],
            event_types: ["message", "read", "reaction"],
        });
        expect(manifest.events.message?.support).toBe("native");
        expect(manifest.events.message_status?.support).toBe("native");
        expect(manifest.events.reaction_added?.support).toBe("unsupported");
        expect(manifest.transports.webhook?.support).toBe("unsupported");
        expect(manifest.transports.manual?.support).toBe("native");
    });

    it("只有显式声明 permissions 时才静态收敛动作", () => {
        const unknown = describeFacebookMessengerCapabilities({});
        expect(unknown.actions.send_message?.support).toBe("native");
        const declared = describeFacebookMessengerCapabilities({
            declared_permissions: ["pages_messaging"],
        });
        expect(declared.actions.send_message?.support).toBe("native");
        expect(declared.actions.get_message_history?.support).toBe("unsupported");
        expect(declared.actions.subscribe_facebook_messenger_page?.support).toBe("unsupported");
    });
});
