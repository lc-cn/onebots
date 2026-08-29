import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** 微信 iLink Bot 当前可用的能力。 */
export const wechatClawbotCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private"] },
        get_login_info: { support: "native" },
        get_friend_list: { support: "emulated", note: "返回本地已知联系人" },
        get_version: { support: "native" },
        get_status: { support: "native" },
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
    },
    transports: {
        ilink: { support: "native", mode: "polling" },
    },
});
