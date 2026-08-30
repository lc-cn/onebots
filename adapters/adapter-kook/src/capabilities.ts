import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { KOOK_PLATFORM_ACTIONS } from "./platform-actions.js";

const platformActions = definePlatformActionCapabilities(KOOK_PLATFORM_ACTIONS, {
    support: "native",
    availability: "permission",
});

/** 与当前 KOOK 官方 API、Gateway 和 Webhook 实现逐项对应的能力清单。 */
export const kookCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "channel"] },
        delete_message: {
            support: "native",
            scenes: ["private", "channel"],
            availability: "context",
            note: "必须提供 scene_type，或消息已由当前进程收发",
        },
        get_message: {
            support: "native",
            scenes: ["private", "channel"],
            availability: "context",
            note: "必须提供 scene_type，或消息已由当前进程收发",
        },
        update_message: {
            support: "native",
            scenes: ["private", "channel"],
            availability: "context",
            note: "仅支持 KMarkdown/Card；消息须已由当前进程收发，显式场景可使用 call_kook_api",
        },
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        get_friend_list: { support: "native" },
        get_friend_info: { support: "native" },
        delete_friend: {
            support: "native",
            note: "支持删除后同时加入 KOOK 屏蔽列表",
        },
        get_friend_requests: {
            support: "native",
            note: "KOOK 不提供申请时间，统一 time 为 0；只返回当前账号收到的申请",
        },
        handle_friend_request: {
            support: "native",
            note: "拒绝时可通过 initiator_uid 同时屏蔽申请人",
        },
        get_guild_list: { support: "native" },
        get_guild_info: { support: "native" },
        get_guild_member_list: { support: "native" },
        get_guild_member_info: { support: "native" },
        get_channel_list: { support: "native" },
        get_channel_info: { support: "native" },
        create_channel: { support: "native", availability: "permission" },
        update_channel: { support: "native", availability: "permission" },
        delete_channel: { support: "native", availability: "permission" },
        get_channel_member_list: {
            support: "native",
            availability: "context",
            note: "KOOK 仅为语音频道提供实时成员列表",
        },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["private", "channel"] },
        member_joined: { support: "native" },
        member_left: { support: "native" },
        group_increase: { support: "native" },
        group_decrease: { support: "native" },
        group_ban: { support: "native" },
        reaction_added: { support: "native", scenes: ["private", "channel"] },
        reaction_removed: { support: "native", scenes: ["private", "channel"] },
        message_updated: { support: "native", scenes: ["private", "channel"] },
        message_deleted: { support: "native", scenes: ["private", "channel"] },
        message_status: { support: "native", scenes: ["channel"] },
        interaction: { support: "native" },
        custom: { support: "native", note: "未标准化系统事件保留完整 raw_event" },
    },
    segments: {
        text: { support: "native", direction: "both" },
        kmarkdown: { support: "native", direction: "send" },
        at: { support: "native", direction: "both" },
        role: { support: "native", direction: "send" },
        channel: { support: "native", direction: "send" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        card: { support: "native", direction: "both" },
        reply: { support: "native", direction: "send" },
    },
    transports: {
        gateway: { support: "native", mode: "websocket" },
        webhook: { support: "native", mode: "webhook" },
        manual: { support: "native", mode: "native", note: "通过 ingest() 接入既有连接" },
    },
});
