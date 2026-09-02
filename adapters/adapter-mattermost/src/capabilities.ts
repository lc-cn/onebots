import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    restrictAdapterEventCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { MATTERMOST_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { MattermostConfig } from "./types.js";

/** Mattermost v11.10 官方 WebSocket event types。 */
export const MATTERMOST_EVENT_TYPES = [
    "posted",
    "ephemeral_message",
    "post_edited",
    "post_deleted",
    "post_unread",
    "reaction_added",
    "reaction_removed",
    "typing",
    "status_change",
    "new_user",
    "user_updated",
    "user_added",
    "user_removed",
    "user_role_updated",
    "direct_added",
    "group_added",
    "added_to_team",
    "leave_team",
    "channel_created",
    "channel_updated",
    "channel_deleted",
    "channel_converted",
    "channel_member_updated",
    "channel_viewed",
    "update_team",
    "delete_team",
    "thread_updated",
    "thread_follow_changed",
    "thread_read_changed",
    "preference_changed",
    "preferences_changed",
    "preferences_deleted",
    "emoji_added",
    "role_updated",
    "memberrole_updated",
    "config_changed",
    "license_changed",
    "shared_channel_remote_updated",
    "property_field_created",
    "property_field_updated",
    "property_field_deleted",
    "property_values_updated",
    "plugin_enabled",
    "plugin_disabled",
    "plugin_statuses_changed",
    "dialog_opened",
    "hello",
] as const;

const permission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["Mattermost token 对目标 team/channel 的对应 permission"],
};

const administrativeActions = new Set([
    "create_mattermost_team",
    "patch_mattermost_team",
    "archive_mattermost_team",
    "restore_mattermost_team",
    "create_mattermost_bot",
    "patch_mattermost_bot",
    "enable_mattermost_bot",
    "disable_mattermost_bot",
]);

const platformActions = definePlatformActionCapabilities(MATTERMOST_PLATFORM_ACTIONS, action => {
    if (administrativeActions.has(action)) {
        return {
            support: "native",
            availability: "permission",
            permissions: ["manage_system 或对应 team 管理权限"],
        } as const;
    }
    if (
        [
            "send_mattermost_typing",
            "get_mattermost_statuses",
            "get_mattermost_statuses_by_ids",
        ].includes(action)
    ) {
        return {
            support: "native",
            availability: "context",
            note: "需要已连接或通过 acceptSocket() 注入的 Mattermost WebSocket",
        } as const;
    }
    if (action.includes("mattermost_channel_bookmark")) {
        return {
            support: "native",
            availability: "permission",
            permissions: ["对应 public/private channel bookmark permission"],
            note: "Mattermost Server >= 9.5",
        } as const;
    }
    if (
        [
            "create_mattermost_scheduled_post",
            "update_mattermost_scheduled_post",
            "delete_mattermost_scheduled_post",
            "list_mattermost_scheduled_posts",
        ].includes(action)
    ) {
        return {
            support: "native",
            availability: "context",
            note: "依赖服务器 Scheduled Posts 功能和许可证配置",
        } as const;
    }
    return { support: "native", availability: "permission" } as const;
});

/** Mattermost REST v4、WebSocket 与平台资源的真实能力边界。 */
export const mattermostCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["direct", "group", "channel"] },
        delete_message: permission,
        get_message: { support: "native" },
        get_message_history: { support: "native" },
        update_message: permission,
        mark_message_as_read: { support: "native" },
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        create_user_channel: { support: "native" },
        get_group_info: { support: "native", availability: "context" },
        get_group_member_list: { support: "native", availability: "context" },
        get_group_member_info: { support: "native", availability: "context" },
        send_group_message_reaction: { support: "native" },
        get_group_essence_messages: { support: "native" },
        set_group_essence_message: permission,
        delete_group_essence_message: permission,
        get_guild_info: { support: "native" },
        get_guild_list: { support: "native" },
        get_guild_member_info: { support: "native" },
        get_guild_member_list: { support: "native" },
        get_channel_info: { support: "native" },
        get_channel_list: { support: "native" },
        create_channel: permission,
        update_channel: permission,
        delete_channel: permission,
        get_channel_member_info: { support: "native" },
        get_channel_member_list: { support: "native" },
        invite_channel_member: permission,
        kick_channel_member: permission,
        upload_file: permission,
        get_file: { support: "native" },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["direct", "group", "channel"] },
        message_updated: { support: "native" },
        message_deleted: { support: "native" },
        reaction_added: { support: "native" },
        reaction_removed: { support: "native" },
        typing_started: { support: "native" },
        user_updated: { support: "native" },
        member_joined: { support: "native" },
        member_left: { support: "native" },
        channel_subscriber_added: { support: "native" },
        channel_subscriber_removed: { support: "native" },
        channel_created: { support: "native" },
        channel_updated: { support: "native" },
        channel_deleted: { support: "native" },
        guild_updated: { support: "native" },
        guild_deleted: { support: "native" },
        custom: {
            support: "native",
            note: "偏好、线程、插件、配置、属性字段及未来事件保留完整 raw_event",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "send", note: "发送需提供 Mattermost username" },
        emoji: { support: "native", direction: "send" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        location: { support: "emulated", direction: "send", note: "编译为地图 Markdown 链接" },
        reply: { support: "native", direction: "send" },
        thread: { support: "native", direction: "both" },
    },
    transports: {
        websocket: {
            support: "native",
            mode: "websocket",
            note: "官方 /api/v4/websocket，支持可靠续接和无限重连",
        },
        existing_socket: {
            support: "native",
            mode: "native",
            note: "acceptSocket() 接收已有 Host 管理的已连接 socket",
        },
        manual: {
            support: "native",
            mode: "native",
            note: "ingest(rawEvent) 接入已有 consumer、代理或消息队列",
        },
    },
});

const canonicalEventTypes: Readonly<Record<string, readonly string[]>> = {
    message: ["posted", "ephemeral_message"],
    message_updated: ["post_edited"],
    message_deleted: ["post_deleted"],
    reaction_added: ["reaction_added"],
    reaction_removed: ["reaction_removed"],
    typing_started: ["typing"],
    user_updated: ["status_change", "new_user", "user_updated"],
    member_joined: ["added_to_team"],
    member_left: ["leave_team"],
    channel_subscriber_added: ["user_added", "direct_added", "group_added"],
    channel_subscriber_removed: ["user_removed"],
    channel_created: ["channel_created"],
    channel_updated: ["channel_updated", "channel_converted", "channel_member_updated"],
    channel_deleted: ["channel_deleted"],
    guild_updated: ["update_team"],
    guild_deleted: ["delete_team"],
};

export function describeMattermostCapabilities(
    config: Pick<MattermostConfig, "event_types" | "receive_mode">,
    socketConnected = false,
): AdapterCapabilityManifest {
    let manifest = mattermostCapabilities;
    if ((config.receive_mode || "websocket") === "manual" && !socketConnected) {
        manifest = defineAdapterCapabilities({
            actions: Object.fromEntries(
                Object.entries(manifest.actions).map(([name, descriptor]) => [
                    name,
                    [
                        "send_mattermost_typing",
                        "get_mattermost_statuses",
                        "get_mattermost_statuses_by_ids",
                    ].includes(name)
                        ? {
                              support: "unsupported" as const,
                              availability: "context" as const,
                              note: "manual 模式需先 acceptSocket() 才能调用 WebSocket action",
                          }
                        : descriptor,
                ]),
            ),
            events: manifest.events,
            segments: manifest.segments,
            transports: manifest.transports,
        });
    }
    if (!config.event_types?.length) return manifest;
    const enabled = new Set(config.event_types);
    const available = new Set<string>();
    const knownCanonicalTypes = new Set(Object.values(canonicalEventTypes).flat());
    if (config.event_types.some(type => !knownCanonicalTypes.has(type))) available.add("custom");
    for (const [event, types] of Object.entries(canonicalEventTypes)) {
        if (types.some(type => enabled.has(type))) available.add(event);
    }
    return restrictAdapterEventCapabilities(manifest, available, event => {
        const required = canonicalEventTypes[event];
        return required
            ? `event_types 未包含可生成此事件的 Mattermost 类型：${required.join(", ")}`
            : "当前 event_types 不会生成此 canonical 事件";
    });
}
