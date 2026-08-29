import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** Zulip REST/Event Queue 当前可用的能力。 */
export const zulipCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "group", "channel"] },
        delete_message: { support: "native" },
        update_message: { support: "native" },
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        get_friend_list: { support: "emulated", note: "按 Realm 用户投影" },
        get_friend_info: { support: "emulated", note: "按 Realm 用户投影" },
        get_group_list: { support: "emulated", note: "按 Stream 投影群组" },
        get_group_info: { support: "emulated", note: "按 Stream 投影群组" },
        get_group_member_list: {
            support: "emulated",
            note: "返回 Realm 用户，Zulip 无 Stream 成员枚举",
        },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group", "channel"] },
        message_updated: { support: "native" },
        message_deleted: { support: "native" },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "both" },
        image: { support: "emulated", direction: "send", note: "以 Markdown 链接发送" },
        file: { support: "emulated", direction: "send", note: "以 Markdown 链接发送" },
    },
    transports: {
        event_queue: { support: "native", mode: "websocket" },
    },
});
