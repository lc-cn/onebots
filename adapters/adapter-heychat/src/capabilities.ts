import {
    defineAdapterCapabilities,
    type AdapterCapabilityManifest,
    type CapabilityDescriptor,
} from "onebots";
import { HEYCHAT_PLATFORM_ACTIONS } from "./platform-actions.js";

const platformActions = Object.fromEntries(
    [...HEYCHAT_PLATFORM_ACTIONS].map(action => [
        action,
        {
            support: "native",
            note:
                action === "call_heychat_api"
                    ? "仅允许官方 chatroom API 路径"
                    : "执行权限由黑盒语音房间权限与接口规则决定",
        } satisfies CapabilityDescriptor,
    ]),
);

/** 黑盒语音官方机器人 API 的真实能力边界。 */
export const heychatCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "channel", "group"] },
        update_message: {
            support: "native",
            scenes: ["channel", "group"],
            availability: "context",
        },
        delete_message: {
            support: "native",
            scenes: ["channel", "group"],
            availability: "context",
        },
        get_login_info: {
            support: "emulated",
            availability: "context",
            note: "机器人 ID 从命令事件获知，名称与头像使用账号配置",
        },
        get_group_list: { support: "native" },
        get_group_info: { support: "native" },
        leave_group: { support: "native" },
        get_group_member_list: { support: "native" },
        get_group_member_info: { support: "native" },
        kick_group_member: {
            support: "native",
            note: "需要管理员或将成员踢出房间权限",
        },
        mute_group_member: {
            support: "native",
            note: "duration=0 解禁，否则按秒禁言；需要对应房间权限",
        },
        set_group_card: {
            support: "native",
            note: "修改他人昵称时需要对应房间权限",
        },
        get_guild_list: { support: "native" },
        get_guild_info: { support: "native" },
        get_guild_member_list: { support: "native" },
        get_guild_member_info: { support: "native" },
        get_channel_list: { support: "native" },
        get_channel_info: { support: "native" },
        create_channel: { support: "native", note: "需要管理频道权限" },
        update_channel: { support: "native", note: "支持修改频道名称" },
        delete_channel: { support: "native", note: "需要管理频道权限" },
        upload_file: { support: "native" },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: {
            support: "native",
            scenes: ["channel"],
            note: "官方 WebSocket 当前仅推送斜杠命令（type=50）",
        },
        reaction_added: { support: "native", scenes: ["channel"] },
        reaction_removed: { support: "native", scenes: ["channel"] },
        member_joined: { support: "native", scenes: ["group"] },
        member_left: { support: "native", scenes: ["group"] },
        interaction: { support: "native", note: "卡片按钮点击事件" },
        custom: { support: "native", note: "未知官方推送通过 raw_event 无损交付" },
    },
    segments: {
        text: { support: "native", direction: "both" },
        markdown: { support: "native", direction: "send" },
        image: { support: "native", direction: "send" },
        at: { support: "native", direction: "send" },
        reply: { support: "native", direction: "send" },
        heychat_role: { support: "native", direction: "send" },
        heychat_channel: { support: "native", direction: "send" },
        heychat_message: {
            support: "native",
            direction: "send",
            note: "承载图片、Markdown、@、卡片等完整官方消息请求体",
        },
    },
    transports: {
        websocket: { support: "native", mode: "websocket" },
        manual: {
            support: "native",
            mode: "native",
            note: "通过 HeychatBot.ingest() 或 acceptWebSocket() 接入已有事件源",
        },
    },
});
