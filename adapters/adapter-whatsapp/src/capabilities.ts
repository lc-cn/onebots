import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

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

/** Meta WhatsApp Cloud API 当前实际可执行的能力。 */
export const whatsAppCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private"] },
        mark_message_as_read: { support: "native", scenes: ["private"] },
        get_login_info: { support: "native" },
        get_user_info: { support: "emulated", note: "Cloud API 不提供任意联系人查询" },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        whatsapp_call: { support: "native" },
        send_native_message: { support: "native", scenes: ["private"] },
        mark_message_read: { support: "native", scenes: ["private"] },
        get_phone_number_info: { support: "native" },
        get_business_profile: { support: "native" },
        update_business_profile: businessManagement,
        upload_media: { support: "native" },
        get_media: { support: "native" },
        download_media: { support: "native" },
        delete_media: { support: "native" },
        register_phone_number: businessMessaging,
        deregister_phone_number: businessMessaging,
        set_two_step_verification: businessMessaging,
        block_user: businessMessaging,
        unblock_user: businessMessaging,
        list_blocked_users: businessMessaging,
        list_message_templates: businessManagement,
        create_message_template: businessManagement,
        delete_message_template: businessManagement,
    },
    events: {
        message: { support: "native", scenes: ["private"] },
        message_status: { support: "native", scenes: ["private"] },
        raw_event: { support: "native" },
        webhook_change: { support: "native" },
    },
    segments: {
        text: { support: "native", direction: "both" },
        reply: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        sticker: { support: "native", direction: "both" },
        location: { support: "native", direction: "both" },
        contacts: { support: "native", direction: "both" },
        reaction: { support: "native", direction: "both" },
        interactive: { support: "native", direction: "both" },
        template: { support: "native", direction: "send" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
    },
});
