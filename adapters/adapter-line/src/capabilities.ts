import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { LINE_PLATFORM_ACTIONS } from "./platform-actions.js";

const permissionActionPrefixes = [
    "add_audience",
    "create_audience",
    "create_click_audience",
    "create_impression_audience",
    "create_upload_audience",
    "add_user_ids_to_audience",
    "get_audience",
    "list_audience",
    "get_shared_audience",
    "list_shared_audience",
    "update_audience",
    "delete_audience",
    "create_liff",
    "list_liff",
    "update_liff",
    "delete_liff",
    "acquire_chat_control",
    "release_chat_control",
    "list_modules",
    "attach_module",
    "detach_module",
    "mission_sticker",
    "create_coupon",
    "get_coupon",
    "list_coupons",
    "close_coupon",
    "get_membership",
    "get_joined_membership",
    "push_messages_by_phone",
    "get_phone_message_statistics",
    "get_group_member_ids",
    "get_room_member_list",
] as const;

const contextActions = new Set([
    "push_message",
    "reply_message",
    "mark_messages_as_read",
    "issue_link_token",
    "get_profile",
    "get_group_summary",
    "get_group_member_count",
    "get_group_member_profile",
    "get_group_member_ids",
    "get_room_member_count",
    "get_room_member_profile",
    "get_room_member_list",
    "leave_room",
    "link_rich_menu_to_user",
    "unlink_rich_menu_from_user",
    "get_user_rich_menu",
]);

const platformActions = definePlatformActionCapabilities(LINE_PLATFORM_ACTIONS, action => {
    if (action === "show_loading_animation") {
        return { support: "native", availability: "always", scenes: ["private"] };
    }
    if (permissionActionPrefixes.some(prefix => action.startsWith(prefix))) {
        return {
            support: "native",
            availability: "permission",
            permissions: ["LINE Official Account 产品资格或专项权限"],
        };
    }
    if (contextActions.has(action)) return { support: "native", availability: "context" };
    return { support: "native", availability: "always" };
});

/** LINE Messaging API 与官方 SDK 11.x 的真实能力边界。 */
export const lineCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        ...platformActions,
        send_message: { support: "native", scenes: ["private", "group"] },
        delete_message: { support: "unsupported" },
        get_message: { support: "unsupported", note: "仅支持按 ID 下载媒体内容" },
        mark_message_as_read: {
            support: "native",
            scenes: ["private", "group"],
            availability: "context",
            note: "message_id 必须来自当前账号接收且包含 markAsReadToken 的事件",
        },
        get_login_info: { support: "native" },
        get_user_info: { support: "native", availability: "context" },
        get_friend_list: {
            support: "native",
            note: "Get followers 受 LINE 账号类型与审核状态限制",
        },
        get_friend_info: { support: "native", availability: "context" },
        get_group_list: { support: "emulated", note: "持久化 Webhook 中已知的 group/room" },
        get_group_info: { support: "native", availability: "context" },
        leave_group: { support: "native" },
        get_group_member_list: { support: "native", availability: "permission" },
        get_group_member_info: { support: "native", availability: "context" },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group"] },
        message_updated: { support: "native", scenes: ["group"] },
        message_deleted: { support: "native", scenes: ["private", "group"] },
        friend_add: { support: "native", scenes: ["private"] },
        user_removed: { support: "native", scenes: ["private"] },
        group_increase: { support: "native", scenes: ["group"] },
        group_decrease: { support: "native", scenes: ["group"] },
        member_joined: { support: "native", scenes: ["group"] },
        member_left: { support: "native", scenes: ["group"] },
        user_updated: {
            support: "native",
            scenes: ["private"],
            note: "会员加入/续订/退出与账号绑定结果使用稳定 sub_type 投影",
        },
        message_status: {
            support: "native",
            note: "LINE notification messages 送达完成事件",
        },
        interaction: {
            support: "native",
            note: "Postback、Beacon 与视频播放完成事件使用稳定 sub_type 投影",
        },
        custom: {
            support: "native",
            note: "Module 控制、Bot suspend/resume 等无对应通用语义的生命周期事件无损交付",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "send" },
        reply: {
            support: "native",
            direction: "both",
            note: "可使用已接收消息的 message_id 自动解析 quoteToken",
        },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "receive" },
        location: { support: "native", direction: "both" },
        sticker: { support: "native", direction: "both" },
        line_message: {
            support: "native",
            direction: "send",
            note: "承载 Flex、Template、Imagemap、Coupon、Quick Reply 等完整官方 Message",
        },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
        manual: {
            support: "native",
            mode: "native",
            note: "通过 await ingest() 接入既有 Host 并等待协议投递",
        },
    },
});
