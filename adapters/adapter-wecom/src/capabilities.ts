import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { WECOM_PLATFORM_ACTIONS } from "./platform-actions.js";

const permission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["企业微信应用可见范围/API 权限"],
};
const platformActions = definePlatformActionCapabilities(WECOM_PLATFORM_ACTIONS, permission);
const directoryPermission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["企业微信通讯录同步 Secret 与写权限"],
};

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
        wecom_directory_call: directoryPermission,
        upload_directory_file: directoryPermission,
        create_department: directoryPermission,
        update_department: directoryPermission,
        delete_department: directoryPermission,
        create_user: directoryPermission,
        update_user: directoryPermission,
        delete_user: directoryPermission,
        batch_delete_users: directoryPermission,
        invite_users: directoryPermission,
        sync_users_from_directory_file: directoryPermission,
        replace_users_from_directory_file: directoryPermission,
        replace_departments_from_directory_file: directoryPermission,
        get_directory_import_result: directoryPermission,
    },
    events: {
        message: { support: "native", scenes: ["private"] },
        user_added: { support: "native" },
        user_updated: { support: "native" },
        user_removed: { support: "native" },
        friend_add: {
            ...permission,
            note: "客户联系 change_external_contact 新增客户事件",
        },
        friend_remove: {
            ...permission,
            note: "客户联系 change_external_contact 删除客户事件",
        },
        interaction: { support: "native", scenes: ["private"] },
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
    transports: {
        webhook: { support: "native", mode: "webhook" },
        manual: {
            support: "native",
            mode: "native",
            note: "通过 ingest()、ingestHttp() 或 acceptHttp() 接入既有 Host",
        },
    },
});
