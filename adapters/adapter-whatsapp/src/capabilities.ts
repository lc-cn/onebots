import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { WHATSAPP_PLATFORM_ACTIONS } from "./platform-actions.js";
import { isWhatsAppGroupAction } from "./groups.js";
import { isWhatsAppCallingAction } from "./calling.js";
import { isWhatsAppHistoryAction } from "./history.js";
import { isWhatsAppSettingsAction } from "./settings.js";
import { isWhatsAppEncryptedMessageAction } from "./encrypted-messages.js";
import { isWhatsAppPhoneNumberAction } from "./phone-numbers.js";
import { isWhatsAppBusinessEncryptionAction } from "./business-encryption.js";
import { isWhatsAppBusinessProfileAction } from "./business-profile.js";
import { isWhatsAppBusinessComplianceAction } from "./business-compliance.js";
import { isWhatsAppSolutionMigrationAction } from "./solution-migration.js";
import { isWhatsAppCommerceAction } from "./commerce.js";
import { isWhatsAppQrCodeAction } from "./qr-codes.js";

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

const groupsAccess = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["whatsapp_business_messaging"],
    scenes: ["group"] as const,
    note: "要求 Meta 为 Official Business Account 开通 Groups API；仅适用于当前 Phone Number 通过该 API 创建和管理的群",
};

const callingAccess = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["whatsapp_business_messaging"],
    scenes: ["private"] as const,
    note: "要求当前 Phone Number 已开通 Cloud API Calling；这里只提供权限与信令控制，媒体平面由调用方实现",
};

const businessManagementActions = new Set([
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
const businessMessagingActions = new Set(["block_user", "unblock_user", "list_blocked_users"]);
const platformActions = definePlatformActionCapabilities(WHATSAPP_PLATFORM_ACTIONS, action => {
    if (isWhatsAppGroupAction(action)) return groupsAccess;
    if (isWhatsAppCallingAction(action)) return callingAccess;
    if (isWhatsAppHistoryAction(action)) return businessMessaging;
    if (isWhatsAppSettingsAction(action)) return businessMessaging;
    if (isWhatsAppEncryptedMessageAction(action)) return businessMessaging;
    if (isWhatsAppPhoneNumberAction(action)) return businessMessaging;
    if (isWhatsAppBusinessEncryptionAction(action)) return businessMessaging;
    if (isWhatsAppBusinessProfileAction(action)) return businessManagement;
    if (isWhatsAppBusinessComplianceAction(action)) return businessManagement;
    if (isWhatsAppSolutionMigrationAction(action)) return businessManagement;
    if (isWhatsAppCommerceAction(action)) return businessManagement;
    if (isWhatsAppQrCodeAction(action)) return businessManagement;
    if (businessManagementActions.has(action)) return businessManagement;
    if (businessMessagingActions.has(action)) return businessMessaging;
    if (action === "send_native_message" || action === "mark_message_read") {
        return { support: "native", scenes: ["private", "group"] };
    }
    return { support: "native" };
});

/** Meta WhatsApp Cloud API 当前实际可执行的能力。 */
export const whatsAppCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        ...platformActions,
        send_message: { support: "native", scenes: ["private", "group"] },
        mark_message_as_read: { support: "native", scenes: ["private", "group"] },
        get_login_info: { support: "native" },
        get_user_info: {
            support: "emulated",
            availability: "context",
            note: "仅返回 Webhook 中实际观察到的联系人资料",
        },
        get_group_list: groupsAccess,
        get_group_info: groupsAccess,
        set_group_name: groupsAccess,
        get_group_member_list: groupsAccess,
        get_group_member_info: groupsAccess,
        kick_group_member: groupsAccess,
        invite_group_member: groupsAccess,
        handle_group_request: groupsAccess,
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group"] },
        message_status: { support: "native", scenes: ["private", "group"] },
        reaction_added: { support: "native", scenes: ["private", "group"] },
        reaction_removed: { support: "native", scenes: ["private", "group"] },
        group_increase: groupsAccess,
        group_decrease: groupsAccess,
        group_request: groupsAccess,
        group_update: groupsAccess,
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
