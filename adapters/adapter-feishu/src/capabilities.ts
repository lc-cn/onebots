import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** 飞书开放平台实现当前可用的能力。 */
export const feishuCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "group"] },
        delete_message: { support: "native" },
        get_message: { support: "native" },
        update_message: { support: "native" },
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        get_friend_list: { support: "emulated", note: "按通讯录用户投影" },
        get_friend_info: { support: "emulated", note: "按通讯录用户投影" },
        get_group_list: { support: "native" },
        get_group_info: { support: "native" },
        leave_group: { support: "native" },
        get_group_member_list: { support: "native" },
        get_group_member_info: { support: "native" },
        kick_group_member: {
            support: "native",
            availability: "permission",
            permissions: ["im:chat.members:write_only"],
        },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        post: { support: "native", direction: "both" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
    },
});
