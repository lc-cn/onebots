import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    restrictAdapterEventCapabilities,
    type AdapterCapabilityManifest,
    type CapabilityDescriptor,
} from "onebots";
import { TWITCH_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { TwitchConfig } from "./types.js";
export { TWITCH_EVENTSUB_TYPES } from "./eventsub-catalog.js";

const permission = (permissions: readonly string[], note?: string): CapabilityDescriptor => ({
    support: "native",
    availability: "permission",
    permissions,
    note,
});

const platformActionScopes: Readonly<Record<string, readonly string[]>> = {
    send_twitch_chat_message: ["user:write:chat"],
    send_twitch_announcement: ["moderator:manage:announcements"],
    send_twitch_whisper: ["user:manage:whispers"],
    get_twitch_chatters: ["moderator:read:chatters"],
    update_twitch_chat_settings: ["moderator:manage:chat_settings"],
    delete_twitch_chat_messages: ["moderator:manage:chat_messages"],
    ban_twitch_user: ["moderator:manage:banned_users"],
    unban_twitch_user: ["moderator:manage:banned_users"],
    warn_twitch_user: ["moderator:manage:warnings"],
    add_twitch_moderator: ["channel:manage:moderators"],
    remove_twitch_moderator: ["channel:manage:moderators"],
    add_twitch_vip: ["channel:manage:vips"],
    remove_twitch_vip: ["channel:manage:vips"],
    add_twitch_blocked_term: ["moderator:manage:blocked_terms"],
    remove_twitch_blocked_term: ["moderator:manage:blocked_terms"],
    create_twitch_custom_reward: ["channel:manage:redemptions"],
    update_twitch_custom_reward: ["channel:manage:redemptions"],
    delete_twitch_custom_reward: ["channel:manage:redemptions"],
    create_twitch_poll: ["channel:manage:polls"],
    end_twitch_poll: ["channel:manage:polls"],
    create_twitch_prediction: ["channel:manage:predictions"],
    resolve_twitch_prediction: ["channel:manage:predictions"],
    start_twitch_raid: ["channel:manage:raids"],
    cancel_twitch_raid: ["channel:manage:raids"],
    update_twitch_schedule: ["channel:manage:schedule"],
    delete_twitch_videos: ["channel:manage:videos"],
};

const platformActions = definePlatformActionCapabilities(TWITCH_PLATFORM_ACTIONS, action => {
    const scopes = platformActionScopes[action];
    return scopes ? permission(scopes) : permission(["目标 Twitch Helix 方法要求的 OAuth scope"]);
});

/** Twitch Helix、EventSub WebSocket/Webhook 与平台资源的真实能力边界。 */
export const twitchCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: permission([
            "user:write:chat + user:bot（频道）或 user:manage:whispers（私信）",
        ]),
        delete_message: permission(["moderator:manage:chat_messages"]),
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        create_user_channel: {
            support: "emulated",
            availability: "permission",
            permissions: ["user:manage:whispers"],
            note: "Twitch 私信没有持久 conversation resource，以收件人 ID 表示 direct channel",
        },
        get_group_list: { support: "native", note: "返回账号配置的 broadcaster channel" },
        get_group_info: { support: "native" },
        get_group_member_list: permission(["moderator:read:chatters"]),
        get_group_member_info: permission(["moderator:read:chatters"]),
        mute_group_member: permission(["moderator:manage:banned_users"]),
        set_group_admin: permission(["channel:manage:moderators"]),
        send_group_announcement: permission(["moderator:manage:announcements"]),
        get_channel_info: { support: "native" },
        get_channel_list: { support: "native", note: "Twitch 账号只绑定一个 broadcaster channel" },
        can_send_image: { support: "native", note: "返回 false；Chat 无原生媒体上传" },
        can_send_record: { support: "native", note: "返回 false；Chat 无原生音频上传" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["channel", "direct"] },
        message_deleted: { support: "native" },
        channel_updated: { support: "native" },
        channel_subscriber_added: { support: "native" },
        channel_subscription_added: { support: "native" },
        channel_subscription_removed: { support: "native" },
        channel_subscription_updated: { support: "native" },
        group_ban: { support: "native" },
        heartbeat: { support: "native" },
        custom: {
            support: "native",
            note: "未专门投影的 EventSub 类型保留完整 raw_event 与 twitch extensions",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "both" },
        emoji: { support: "native", direction: "both" },
        image: { support: "emulated", direction: "send", note: "编译为公开 URL 文本" },
        video: { support: "emulated", direction: "send", note: "编译为公开 URL 文本" },
        audio: { support: "emulated", direction: "send", note: "编译为公开 URL 文本" },
        file: { support: "emulated", direction: "send", note: "编译为公开 URL 文本" },
        reply: { support: "native", direction: "send" },
    },
    transports: {
        eventsub_websocket: {
            support: "native",
            mode: "websocket",
            note: "用户令牌、官方 reconnect_url 无损迁移、断线重订阅与无限退避",
        },
        eventsub_webhook: {
            support: "native",
            mode: "webhook",
            note: "应用令牌自动订阅；acceptHttp() 校验 HMAC、时窗、challenge 与重复投递",
        },
        existing_socket: {
            support: "native",
            mode: "native",
            note: "acceptSocket() 接收已有 Host 完成升级的 EventSub socket",
        },
        manual: {
            support: "native",
            mode: "native",
            note: "ingest(rawEvent) 复用严格解析、过滤、去重与 canonical 投影",
        },
    },
});

const canonicalSources: Readonly<Record<string, readonly string[]>> = {
    message: ["channel.chat.message", "whisper.received"],
    message_deleted: ["channel.chat.message_delete", "channel.chat.clear_user_messages"],
    channel_updated: ["channel.update", "channel.chat_settings.update"],
    channel_subscriber_added: ["channel.follow"],
    channel_subscription_added: ["channel.subscribe"],
    channel_subscription_removed: ["channel.subscription.end"],
    channel_subscription_updated: ["channel.subscription.gift", "channel.subscription.message"],
    group_ban: ["channel.ban", "channel.unban"],
};

export function describeTwitchCapabilities(
    config: Pick<TwitchConfig, "subscriptions">,
    tokenScopes?: readonly string[],
): AdapterCapabilityManifest {
    const configured = new Set(
        config.subscriptions?.map(item => item.type) || ["channel.chat.message"],
    );
    const available = new Set<string>(["heartbeat"]);
    const known = new Set(Object.values(canonicalSources).flat());
    for (const [event, sources] of Object.entries(canonicalSources)) {
        if (sources.some(source => configured.has(source))) available.add(event);
    }
    if ([...configured].some(type => !known.has(type))) available.add("custom");
    const events = restrictAdapterEventCapabilities(
        twitchCapabilities,
        available,
        event => `EventSub subscriptions 未包含可生成 ${event} 的类型`,
    );
    return tokenScopes ? restrictScopes(events, new Set(tokenScopes)) : events;
}

const canonicalActionScopes: Readonly<Record<string, readonly string[]>> = {
    delete_message: ["moderator:manage:chat_messages"],
    get_group_member_list: ["moderator:read:chatters"],
    get_group_member_info: ["moderator:read:chatters"],
    mute_group_member: ["moderator:manage:banned_users"],
    set_group_admin: ["channel:manage:moderators"],
    send_group_announcement: ["moderator:manage:announcements"],
};

function restrictScopes(
    manifest: AdapterCapabilityManifest,
    scopes: ReadonlySet<string>,
): AdapterCapabilityManifest {
    const actions = { ...manifest.actions };
    for (const [action, required] of Object.entries({
        ...canonicalActionScopes,
        ...platformActionScopes,
    })) {
        if (required.some(scope => scopes.has(scope)) || !actions[action]) continue;
        actions[action] = {
            support: "unsupported",
            availability: "permission",
            permissions: required,
            note: "当前 access_token 不包含此动作所需 scope",
        };
    }
    return defineAdapterCapabilities({
        actions,
        events: manifest.events,
        segments: manifest.segments,
        transports: manifest.transports,
    });
}
