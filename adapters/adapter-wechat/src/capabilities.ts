import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** 微信公众号接口当前可用的能力。 */
export const wechatCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private"] },
        get_login_info: { support: "native" },
        get_user_info: {
            support: "native",
            availability: "permission",
            permissions: ["user.info"],
        },
        get_friend_list: { support: "native", note: "返回公众号关注用户" },
        get_friend_info: { support: "native", note: "返回公众号关注用户信息" },
        get_group_list: { support: "emulated", note: "按公众号用户标签投影群组" },
        get_group_info: { support: "emulated", note: "按公众号用户标签投影群组" },
        set_group_name: { support: "emulated", note: "修改公众号用户标签名称" },
        get_group_member_list: { support: "emulated", note: "返回指定公众号用户标签下的用户" },
        get_group_member_info: { support: "emulated", note: "投影关注用户及其标签信息" },
        set_group_card: { support: "emulated", note: "修改公众号关注用户备注" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private"] },
        friend_add: { support: "native", scenes: ["private"] },
        unsubscribe: { support: "native", scenes: ["private"] },
        scan: { support: "native", scenes: ["private"] },
        location: { support: "native", scenes: ["private"] },
        menu_click: { support: "native", scenes: ["private"] },
        menu_view: { support: "native", scenes: ["private"] },
    },
    segments: {
        text: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        audio: { support: "native", direction: "receive" },
        video: { support: "native", direction: "receive" },
        link: { support: "native", direction: "receive" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
    },
});
