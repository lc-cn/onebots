import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** WhatsApp Cloud API 当前可用的能力。 */
export const whatsAppCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private"] },
        get_login_info: { support: "native" },
        get_user_info: { support: "emulated", note: "仅按电话号码生成基础用户信息" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private"] },
        message_status: { support: "native", scenes: ["private"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        location: { support: "native", direction: "both" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
    },
});
