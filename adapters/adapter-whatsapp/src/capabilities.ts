import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { WHATSAPP_PLATFORM_ACTIONS } from "./platform-actions.js";

const businessManagement = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["whatsapp_business_management"],
};

const businessMessaging = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["whatsapp_business_messaging"],
};

const businessManagementActions = new Set([
    "update_business_profile",
    "get_commerce_settings",
    "update_commerce_settings",
    "list_qr_codes",
    "get_qr_code",
    "create_qr_code",
    "update_qr_code",
    "delete_qr_code",
    "list_message_templates",
    "create_message_template",
    "delete_message_template",
    "list_flows",
    "create_flow",
    "get_flow",
    "update_flow",
    "delete_flow",
    "publish_flow",
    "deprecate_flow",
]);
const businessMessagingActions = new Set([
    "register_phone_number",
    "deregister_phone_number",
    "set_two_step_verification",
    "block_user",
    "unblock_user",
    "list_blocked_users",
]);
const platformActions = definePlatformActionCapabilities(WHATSAPP_PLATFORM_ACTIONS, action => {
    if (businessManagementActions.has(action)) return businessManagement;
    if (businessMessagingActions.has(action)) return businessMessaging;
    if (action === "send_native_message" || action === "mark_message_read") {
        return { support: "native", scenes: ["private"] };
    }
    return { support: "native" };
});

/** Meta WhatsApp Cloud API 当前实际可执行的能力。 */
export const whatsAppCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        ...platformActions,
        send_message: { support: "native", scenes: ["private"] },
        mark_message_as_read: { support: "native", scenes: ["private"] },
        get_login_info: { support: "native" },
        get_user_info: {
            support: "emulated",
            availability: "context",
            note: "仅返回 Webhook 中实际观察到的联系人资料",
        },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private"] },
        message_status: { support: "native", scenes: ["private"] },
        reaction_added: { support: "native", scenes: ["private"] },
        reaction_removed: { support: "native", scenes: ["private"] },
        raw_event: { support: "native" },
        webhook_change: { support: "native" },
    },
    segments: {
        text: { support: "native", direction: "both" },
        reply: { support: "native", direction: "both" },
        image: {
            support: "native",
            direction: "both",
            note: "media_id/HTTPS 直发，本地、HTTP 与 Base64 自动上传",
        },
        video: {
            support: "native",
            direction: "both",
            note: "media_id/HTTPS 直发，本地、HTTP 与 Base64 自动上传",
        },
        audio: {
            support: "native",
            direction: "both",
            note: "media_id/HTTPS 直发，本地、HTTP 与 Base64 自动上传",
        },
        file: {
            support: "native",
            direction: "both",
            note: "media_id/HTTPS 直发，本地、HTTP 与 Base64 自动上传",
        },
        sticker: {
            support: "native",
            direction: "both",
            note: "media_id/HTTPS 直发，本地、HTTP 与 Base64 自动上传",
        },
        location: { support: "native", direction: "both" },
        contacts: { support: "native", direction: "both" },
        reaction: { support: "native", direction: "both" },
        interactive: { support: "native", direction: "both" },
        template: { support: "native", direction: "send" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
        manual: {
            support: "native",
            mode: "native",
            note: "通过 ingest()/ingestHttp()/acceptHttp() 接入既有 Host",
        },
    },
});
