import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** 钉钉适配器已经由运行时实现验证的能力。 */
export const dingTalkCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "group"] },
        get_login_info: { support: "native" },
        get_user_info: {
            support: "native",
            availability: "permission",
            permissions: ["contact.user.read"],
        },
        get_friend_info: {
            support: "emulated",
            availability: "permission",
            permissions: ["contact.user.read"],
            note: "按通讯录用户投影好友信息",
        },
        get_group_member_info: {
            support: "emulated",
            availability: "permission",
            permissions: ["contact.user.read"],
            note: "钉钉不提供群成员详情，按通讯录用户投影",
        },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "send" },
        image: { support: "native", direction: "send" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
    },
});
