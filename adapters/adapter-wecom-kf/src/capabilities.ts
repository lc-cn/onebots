import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";
import { WECOM_KF_PLATFORM_ACTIONS } from "./platform-actions.js";

const permission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["微信客服 API 权限/客服账号管理权"],
};
const platformActions = Object.fromEntries(
    [...WECOM_KF_PLATFORM_ACTIONS].map(action => [action, { ...permission }]),
);

/** 微信客服官方 API 的实际能力，不声明普通企业微信或群聊能力。 */
export const weComKfCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { ...permission, scenes: ["private", "direct"] },
        get_login_info: permission,
        get_user_info: permission,
        upload_file: { ...permission, scenes: ["private", "direct"] },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["private", "direct"] },
        customer_event: { support: "native", scenes: ["private"] },
        raw_event: { support: "native" },
        custom: { support: "native" },
    },
    segments: {
        text: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        location: { support: "native", direction: "both" },
        link: { support: "native", direction: "both" },
        contact: { support: "native", direction: "receive" },
        miniprogram: { support: "native", direction: "both" },
        msgmenu: { support: "native", direction: "both" },
        wecom_kf_message: { support: "native", direction: "both" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
        sync: { support: "native", mode: "polling" },
    },
});
