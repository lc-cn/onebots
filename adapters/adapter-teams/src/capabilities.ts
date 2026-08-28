import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** Microsoft Teams 当前经过真实实现和事件链路验证的能力。 */
export const teamsCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "direct", "group", "channel"] },
        delete_message: {
            support: "native",
            availability: "context",
            scenes: ["private", "direct", "group", "channel"],
            note: "需要 conversation id",
        },
        get_login_info: { support: "native" },
        get_status: { support: "native" },
        get_version: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group"] },
        message_updated: { support: "native", scenes: ["private", "group"] },
        message_deleted: { support: "native", scenes: ["private", "group"] },
        member_joined: { support: "native", scenes: ["group"] },
        member_left: { support: "native", scenes: ["group"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "both" },
        image: { support: "emulated", direction: "both", note: "发送时转换为链接文本" },
        file: { support: "emulated", direction: "both", note: "发送时转换为链接文本" },
        video: { support: "native", direction: "receive" },
        audio: { support: "native", direction: "receive" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
    },
});
