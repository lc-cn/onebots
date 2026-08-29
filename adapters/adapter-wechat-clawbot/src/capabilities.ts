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
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        audio: { support: "native", direction: "receive" },
        wechat_clawbot_raw: { support: "native", direction: "receive" },
    },
    transports: {
        ilink: { support: "native", mode: "polling" },
    },
});
