import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** Telegram Bot API 当前可用的能力。 */
export const telegramCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "group", "channel"] },
        delete_message: { support: "native" },
        update_message: { support: "native" },
        get_login_info: { support: "native" },
        get_group_info: { support: "native" },
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
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group", "channel"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "emulated", direction: "both", note: "按 Telegram mention 文本投影" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
        polling: { support: "native", mode: "polling" },
    },
});
