import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** SMTP/IMAP 适配器实际暴露的能力。 */
export const emailCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private"] },
        get_login_info: { support: "native" },
        get_user_info: { support: "emulated", note: "仅按邮箱地址生成基础用户信息" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        image: { support: "native", direction: "send" },
    },
    transports: {
        imap: { support: "native", mode: "polling" },
    },
});
