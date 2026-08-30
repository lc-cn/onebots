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
        expect(whatsAppCapabilities.actions.send_native_message?.scenes).toEqual([
            "private",
            "group",
        ]);
        expect(whatsAppCapabilities.actions.create_group?.permissions).toEqual([
            "whatsapp_business_messaging",
        ]);
        expect(whatsAppCapabilities.actions.create_group?.note).toContain(
            "Official Business Account",
        );
        expect(whatsAppCapabilities.actions.get_group_info?.scenes).toEqual(["group"]);
        expect(whatsAppCapabilities.actions.create_flow?.permissions).toEqual([
            "whatsapp_business_management",
        ]);
        expect(whatsAppCapabilities.actions.block_users?.permissions).toEqual([
            "whatsapp_business_messaging",
        ]);
        expect(whatsAppCapabilities.actions.connect_call).toMatchObject({
            availability: "permission",
            permissions: ["whatsapp_business_messaging"],
            scenes: ["private"],
        });
        expect(whatsAppCapabilities.actions.connect_call?.note).toContain("媒体平面");
        expect(whatsAppCapabilities.actions.list_message_history?.permissions).toEqual([
            "whatsapp_business_messaging",
        ]);
        expect(
            whatsAppCapabilities.actions.update_payload_encryption_settings?.permissions,
        ).toEqual(["whatsapp_business_messaging"]);
        expect(whatsAppCapabilities.actions.send_encrypted_message?.permissions).toEqual([
            "whatsapp_business_messaging",
        ]);
        expect(
            whatsAppCapabilities.actions.request_phone_number_verification_code?.permissions,
        ).toEqual(["whatsapp_business_messaging"]);
        expect(whatsAppCapabilities.actions.verify_phone_number_code?.permissions).toEqual([
            "whatsapp_business_messaging",
        ]);
        expect(whatsAppCapabilities.actions.set_business_encryption_key?.permissions).toEqual([
            "whatsapp_business_messaging",
        ]);
        expect(whatsAppCapabilities.actions.get_business_profile?.permissions).toEqual([
            "whatsapp_business_management",
        ]);
        expect(whatsAppCapabilities.actions.update_business_profile?.permissions).toEqual([
            "whatsapp_business_management",
        ]);
        expect(whatsAppCapabilities.actions.get_business_compliance_info?.permissions).toEqual([
            "whatsapp_business_management",
        ]);
        expect(whatsAppCapabilities.actions.update_business_compliance_info?.permissions).toEqual([
            "whatsapp_business_management",
        ]);
        expect(whatsAppCapabilities.actions.get_migration_intent?.permissions).toEqual([
            "whatsapp_business_management",
        ]);
        expect(whatsAppCapabilities.actions.set_solution_migration_intent?.permissions).toEqual([
            "whatsapp_business_management",
        ]);
    });
});
