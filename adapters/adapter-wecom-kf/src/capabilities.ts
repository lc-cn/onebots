import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** 企业微信客服接口当前可用的能力。 */
export const weComKfCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "direct"] },
        get_login_info: { support: "native" },
        get_user_info: { support: "emulated", note: "按 external_userid 投影基础用户信息" },
        get_friend_info: { support: "emulated", note: "按 external_userid 投影客户信息" },
        upload_file: { support: "native", scenes: ["private", "direct"] },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "direct"] },
        customer_event: { support: "native", scenes: ["private"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        location: { support: "native", direction: "receive" },
        link: { support: "native", direction: "receive" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
        sync: { support: "native", mode: "polling" },
    },
});
