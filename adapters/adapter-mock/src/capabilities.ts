import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** Mock 只声明真正模拟且可断言状态变化的能力。 */
export const mockCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "group"] },
        delete_message: { support: "native", scenes: ["private", "group"] },
        get_message: { support: "native", scenes: ["private", "group"] },
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        get_friend_list: { support: "native" },
        get_friend_info: { support: "native" },
        get_group_list: { support: "native" },
        get_group_info: { support: "native" },
        get_group_member_list: { support: "native" },
        get_group_member_info: { support: "native" },
        get_status: { support: "native" },
        get_version: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group"] },
        friend_request: { support: "native" },
        heartbeat: { support: "native" },
    },
    segments: {
        text: { support: "native", direction: "both" },
    },
    transports: {
        native: { support: "native", mode: "native" },
    },
});
