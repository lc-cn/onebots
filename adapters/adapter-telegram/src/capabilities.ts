import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** Telegram Bot API 当前可用的能力。 */
export const telegramCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "group", "channel"] },
        delete_message: { support: "native", availability: "context" },
        update_message: { support: "native", availability: "context" },
        get_login_info: { support: "native" },
        get_group_info: { support: "native" },
        set_group_name: {
            support: "native",
            availability: "permission",
            permissions: ["can_change_info"],
        },
        leave_group: { support: "native" },
        get_group_member_list: {
            support: "emulated",
            note: "Bot API 只能枚举管理员，结果不是完整成员列表",
        },
        get_group_member_info: { support: "native" },
        kick_group_member: {
            support: "native",
            availability: "permission",
            permissions: ["can_restrict_members"],
        },
        mute_group_member: {
            support: "native",
            availability: "permission",
            permissions: ["can_restrict_members"],
        },
        set_group_admin: {
            support: "native",
            availability: "permission",
            permissions: ["can_promote_members"],
        },
        set_group_special_title: {
            support: "native",
            availability: "permission",
            permissions: ["can_promote_members"],
        },
        handle_group_request: {
            support: "native",
            availability: "permission",
            permissions: ["can_invite_users"],
        },
        get_file: { support: "native" },
        send_poll: { support: "native", scenes: ["private", "group", "channel"] },
        forward_message: { support: "native" },
        copy_message: { support: "native" },
        set_message_reaction: { support: "native" },
        pin_message: {
            support: "native",
            availability: "permission",
            permissions: ["can_pin_messages"],
        },
        unpin_message: {
            support: "native",
            availability: "permission",
            permissions: ["can_pin_messages"],
        },
        create_chat_invite_link: {
            support: "native",
            availability: "permission",
            permissions: ["can_invite_users"],
        },
        set_chat_description: {
            support: "native",
            availability: "permission",
            permissions: ["can_change_info"],
        },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group", "channel"] },
        message_updated: { support: "native" },
        interaction: { support: "native" },
        member_joined: { support: "native" },
        member_left: { support: "native" },
        group_request: { support: "native" },
        message_reaction: { support: "native" },
        native_update: {
            support: "native",
            note: "未标准化的 Telegram Update 以 custom notice 和 raw_event 无损交付",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "emulated", direction: "both", note: "按 Telegram mention 文本投影" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        sticker: { support: "native", direction: "both" },
        location: { support: "native", direction: "both" },
        contact: { support: "native", direction: "both" },
        reply: { support: "native", direction: "both" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
        polling: { support: "native", mode: "polling" },
    },
});
