import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";

/** 企业微信应用当前经过真实实现和事件链路验证的能力。 */
export const weComCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "direct"] },
        delete_message: { support: "unsupported", note: "企业微信不支持撤回应用消息" },
        get_message: { support: "unsupported", note: "企业微信不支持主动获取应用消息" },
        update_message: { support: "unsupported", note: "企业微信不支持更新应用消息" },
        get_login_info: { support: "native" },
        get_user_info: {
            support: "native",
            availability: "permission",
            permissions: ["通讯录读取"],
        },
        get_friend_info: {
            support: "emulated",
            availability: "permission",
            permissions: ["通讯录读取"],
        },
        get_friend_list: { support: "unsupported", note: "企业微信没有好友列表概念" },
        get_group_list: {
            support: "emulated",
            availability: "permission",
            permissions: ["通讯录读取"],
            note: "返回部门列表",
        },
        get_group_info: {
            support: "emulated",
            availability: "permission",
            permissions: ["通讯录读取"],
            note: "返回部门信息",
        },
        get_group_member_list: {
            support: "emulated",
            availability: "permission",
            permissions: ["通讯录读取"],
            note: "返回部门成员",
        },
        get_group_member_info: {
            support: "emulated",
            availability: "permission",
            permissions: ["通讯录读取"],
            note: "返回部门成员",
        },
        leave_group: { support: "unsupported", note: "企业微信应用不能退出部门" },
        kick_group_member: { support: "unsupported", note: "企业微信应用不能从部门移除成员" },
        set_group_card: { support: "unsupported", note: "企业微信部门没有群名片" },
        get_status: { support: "native" },
        get_version: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private"] },
        user_added: { support: "native" },
        user_updated: { support: "native" },
        user_removed: { support: "native" },
        custom: { support: "native" },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "emulated", direction: "send", note: "转换为可读文本" },
        image: { support: "emulated", direction: "both", note: "发送外链时转换为可读文本" },
        audio: { support: "native", direction: "receive" },
        video: { support: "native", direction: "receive" },
        location: { support: "native", direction: "receive" },
        link: { support: "native", direction: "receive" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
    },
});
