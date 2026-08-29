import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";
import { WECHAT_PLATFORM_ACTIONS } from "./platform-actions.js";

const nativePermission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["wechat.official_account.api"],
};
const platformActions = Object.fromEntries(
    [...WECHAT_PLATFORM_ACTIONS].map(action => [action, nativePermission]),
);

/** 微信公众号当前实际可执行的能力；用户标签不伪装成聊天群组。 */
export const wechatCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: {
            support: "native",
            availability: "context",
            scenes: ["private"],
            note: "依赖被动回复窗口或微信客服消息会话窗口",
        },
        get_login_info: { support: "native" },
        get_user_info: nativePermission,
        get_friend_list: { ...nativePermission, note: "返回已关注用户" },
        get_friend_info: { ...nativePermission, note: "返回已关注用户" },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["private"] },
        friend_add: { support: "native", scenes: ["private"] },
        unsubscribe: { support: "native", scenes: ["private"] },
        scan: { support: "native", scenes: ["private"] },
        location: { support: "native", scenes: ["private"] },
        menu: { support: "native", scenes: ["private"] },
        template_status: { support: "native", scenes: ["private"] },
        mass_send_status: { support: "native" },
        raw_event: { support: "native" },
    },
    segments: {
        text: { support: "native", direction: "both" },
        reply: { support: "native", direction: "send" },
        image: { support: "native", direction: "both" },
        voice: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        location: { support: "native", direction: "receive" },
        link: { support: "native", direction: "receive" },
        news: { support: "native", direction: "send" },
        wechat_message: { support: "native", direction: "both" },
    },
    transports: { webhook: { support: "native", mode: "webhook" } },
});
