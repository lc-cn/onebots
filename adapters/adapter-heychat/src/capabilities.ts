import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** 黑盒语音机器人接口当前可用的能力。 */
export const heychatCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["group", "channel"] },
        delete_message: { support: "native", scenes: ["group", "channel"] },
        get_login_info: { support: "native" },
        get_group_info: { support: "emulated", note: "根据已知房间上下文投影" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["group", "channel"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        image: { support: "emulated", direction: "send", note: "转换为平台可识别内容" },
        at: { support: "emulated", direction: "send", note: "转换为文本提及" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
    },
});
