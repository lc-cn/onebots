import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** Slack Web API/Events API 当前可用的能力。 */
export const slackCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "group", "channel"] },
        delete_message: { support: "native" },
        update_message: { support: "native" },
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        get_friend_list: { support: "emulated", note: "按工作区用户投影" },
        get_friend_info: { support: "emulated", note: "按工作区用户投影" },
        get_group_list: { support: "emulated", note: "按频道投影群组" },
        get_group_info: { support: "emulated", note: "按频道投影群组" },
        leave_group: { support: "native" },
        get_group_member_list: { support: "native" },
        get_group_member_info: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group", "channel"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "send" },
        image: { support: "native", direction: "send" },
        file: { support: "native", direction: "send" },
    },
    transports: {
        socket_mode: { support: "native", mode: "websocket" },
        webhook: { support: "native", mode: "webhook" },
    },
});
