import { describe, expect, it } from "vitest";
import { describeInstagramCapabilities, instagramCapabilities } from "./capabilities.js";

describe("Instagram capabilities", () => {
    it("全局清单只声明 direct scene，并公开真实平台特性", () => {
        expect(instagramCapabilities.actions.send_message?.scenes).toEqual(["direct"]);
        expect(instagramCapabilities.events.message?.scenes).toEqual(["direct"]);
        expect(instagramCapabilities.actions.send_instagram_human_agent).toMatchObject({
            support: "native",
            availability: "permission",
        });
        expect(instagramCapabilities.actions.create_instagram_welcome_message_flow?.support).toBe(
            "native",
        );
        expect(instagramCapabilities.segments.instagram_reply_context).toMatchObject({
            direction: "receive",
        });
    });

    it("按 webhook fields/event types 动态收敛事件能力", () => {
        const manifest = describeInstagramCapabilities({
            subscribed_fields: ["messaging_seen"],
            event_types: ["message", "read", "reaction"],
        });
        expect(manifest.events.message?.support).toBe("unsupported");
        expect(manifest.events.message_status?.support).toBe("native");
        expect(manifest.events.reaction_added?.support).toBe("unsupported");
    });

    it("manual 模式禁用 webhook 展示，声明权限后收敛动作", () => {
        const manifest = describeInstagramCapabilities({
            receive_mode: "manual",
            declared_permissions: ["instagram_business_basic"],
        });
        expect(manifest.transports.webhook?.support).toBe("unsupported");
        expect(manifest.actions.get_login_info?.support).toBe("native");
        expect(manifest.actions.send_message?.support).toBe("unsupported");
        expect(manifest.actions.send_instagram_human_agent?.support).toBe("unsupported");
    });
});
