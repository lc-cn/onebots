import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** 微信 iLink Bot 当前可用的能力。 */
export const wechatClawbotCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: {
            support: "native",
            availability: "context",
            scenes: ["private"],
            note: "需要对端最近消息提供的有效 context_token",
        },
        get_login_info: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        send_typing: { support: "native", availability: "context", scenes: ["private"] },
        download_media: { support: "native", availability: "context", scenes: ["private"] },
        can_send_image: { support: "native" },
        can_send_record: {
            support: "native",
            note: "iLink 当前仅支持接收语音，不能发送标准语音消息",
        },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        audio: { support: "native", direction: "receive" },
        reply: { support: "native", direction: "receive" },
        wechat_clawbot_reference: { support: "native", direction: "receive" },
        wechat_clawbot_tool_call_start: { support: "native", direction: "receive" },
        wechat_clawbot_tool_call_result: { support: "native", direction: "receive" },
        wechat_clawbot_raw: { support: "native", direction: "receive" },
    },
    transports: {
        ilink: { support: "native", mode: "polling" },
    },
});
