import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";
import { WECOM_PLATFORM_ACTIONS } from "./platform-actions.js";

const permission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["企业微信应用可见范围/API 权限"],
};
const platformActions = Object.fromEntries(
    [...WECOM_PLATFORM_ACTIONS].map(action => [action, permission]),
);

/** 企业微信自建应用实际能力；部门与标签不再伪装成聊天群。 */
export const weComCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { ...permission, scenes: ["private", "direct", "group"] },
        delete_message: {
            ...permission,
            scenes: ["private", "direct"],
            note: "仅撤回返回服务端 msgid 且仍在时限内的应用消息；appchat 不返回 msgid",
        },
        get_login_info: permission,
        get_user_info: permission,
        get_group_info: { ...permission, note: "仅应用创建的 appchat" },
        get_group_member_list: { ...permission, note: "仅应用创建的 appchat" },
        get_group_member_info: { ...permission, note: "仅应用创建的 appchat" },
        upload_file: { ...permission, scenes: ["private", "direct", "group"] },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_status: { support: "native" },
        get_version: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["private"] },
        user_added: { support: "native" },
        user_updated: { support: "native" },
        user_removed: { support: "native" },
        raw_event: { support: "native" },
        custom: { support: "native" },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: {
            support: "emulated",
            direction: "send",
            note: "转为 @userid 可读文本，不承诺客户端提醒",
        },
        image: { support: "native", direction: "both" },
        voice: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        markdown: { support: "native", direction: "send" },
        location: { support: "native", direction: "receive" },
        link: { support: "native", direction: "receive" },
        wecom_message: { support: "native", direction: "both" },
    },
    transports: { webhook: { support: "native", mode: "webhook" } },
});
