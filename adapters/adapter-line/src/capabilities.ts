import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** LINE Messaging API 当前可用的能力。 */
export const lineCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "group"] },
        get_login_info: { support: "native" },
        get_user_info: { support: "native", availability: "context" },
        get_friend_list: { support: "native" },
        get_friend_info: { support: "native" },
        get_group_list: { support: "emulated", note: "仅返回事件中已知的群组" },
        get_group_info: { support: "native", availability: "context" },
        leave_group: { support: "native" },
        get_group_member_list: { support: "native" },
        get_group_member_info: { support: "native" },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group"] },
        friend_add: { support: "native", scenes: ["private"] },
        group_member_increase: { support: "native", scenes: ["group"] },
        group_member_decrease: { support: "native", scenes: ["group"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "receive" },
        location: { support: "native", direction: "both" },
        face: { support: "native", direction: "receive" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
    },
});
