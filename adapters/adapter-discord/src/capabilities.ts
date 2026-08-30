import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    type AdapterCapabilityManifest,
    type CapabilityDescriptor,
} from "onebots";
import { DISCORD_PLATFORM_ACTIONS } from "./platform-actions.js";

const manageMessages = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["MANAGE_MESSAGES"],
};
const manageRoles = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["MANAGE_ROLES"],
};
const manageThreads = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["MANAGE_THREADS"],
};
const manageGuild = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["MANAGE_GUILD"],
};
const manageEvents = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["CREATE_EVENTS / MANAGE_EVENTS（取决于创建者与事件类型）"],
};
const manageExpressions = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["CREATE_GUILD_EXPRESSIONS / MANAGE_GUILD_EXPRESSIONS"],
};

const autoModerationActions = new Set([
    "list_auto_moderation_rules",
    "get_auto_moderation_rule",
    "create_auto_moderation_rule",
    "update_auto_moderation_rule",
    "delete_auto_moderation_rule",
]);
const scheduledEventWriteActions = new Set([
    "create_scheduled_event",
    "update_scheduled_event",
    "delete_scheduled_event",
]);
const emojiWriteActions = new Set([
    "create_guild_emoji",
    "update_guild_emoji",
    "delete_guild_emoji",
]);

const native: CapabilityDescriptor = { support: "native" };
const platformActionDescriptors: Readonly<Record<string, CapabilityDescriptor>> = {
    call_discord_api: {
        support: "native",
        availability: "context",
        note: "受当前 Bot token 权限约束的完整 Discord v10 REST API 入口",
    },
    send_gateway_command: {
        support: "native",
        availability: "context",
        note: "发送 Presence、Voice State、Guild Members、Soundboard Sounds 与 Channel Info Gateway 主动事件",
    },
    ban_member: {
        support: "native",
        availability: "permission",
        permissions: ["BAN_MEMBERS"],
    },
    unban_member: {
        support: "native",
        availability: "permission",
        permissions: ["BAN_MEMBERS"],
    },
    get_guild_bans: {
        support: "native",
        availability: "permission",
        permissions: ["BAN_MEMBERS"],
    },
    create_guild_role: manageRoles,
    update_guild_role: manageRoles,
    delete_guild_role: manageRoles,
    add_guild_member_role: manageRoles,
    remove_guild_member_role: manageRoles,
    bulk_delete_messages: manageMessages,
    crosspost_message: {
        support: "native",
        availability: "permission",
        permissions: ["SEND_MESSAGES"],
    },
    pin_message: {
        support: "native",
        availability: "permission",
        permissions: ["PIN_MESSAGES"],
    },
    unpin_message: {
        support: "native",
        availability: "permission",
        permissions: ["PIN_MESSAGES"],
    },
    create_thread: manageThreads,
    remove_thread_member: manageThreads,
    get_channel_invites: {
        support: "native",
        availability: "permission",
        permissions: ["MANAGE_CHANNELS"],
    },
    create_channel_invite: {
        support: "native",
        availability: "permission",
        permissions: ["CREATE_INSTANT_INVITE"],
    },
    delete_invite: {
        support: "native",
        availability: "permission",
        permissions: ["MANAGE_CHANNELS"],
    },
    kick_guild_member: {
        support: "native",
        availability: "permission",
        permissions: ["KICK_MEMBERS"],
    },
    timeout_guild_member: {
        support: "native",
        availability: "permission",
        permissions: ["MODERATE_MEMBERS"],
    },
    set_guild_member_nickname: {
        support: "native",
        availability: "permission",
        permissions: ["MANAGE_NICKNAMES"],
    },
};
const platformActions = definePlatformActionCapabilities(DISCORD_PLATFORM_ACTIONS, action => {
    if (autoModerationActions.has(action)) return manageGuild;
    if (scheduledEventWriteActions.has(action)) return manageEvents;
    if (emojiWriteActions.has(action)) return manageExpressions;
    return platformActionDescriptors[action] ?? native;
});

/** Discord REST/Gateway 实现当前可用的能力。 */
export const discordCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        ...platformActions,
        send_message: { support: "native", scenes: ["private", "channel"] },
        delete_message: { support: "native", scenes: ["private", "channel"] },
        get_message: { support: "native", scenes: ["private", "channel"] },
        get_message_history: { support: "native", scenes: ["private", "channel"] },
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        get_guild_info: { support: "native" },
        get_guild_list: { support: "native" },
        get_guild_member_info: { support: "native" },
        get_guild_member_list: { support: "native" },
        get_channel_info: { support: "native" },
        get_channel_list: { support: "native" },
        create_channel: {
            support: "native",
            availability: "permission",
            permissions: ["MANAGE_CHANNELS"],
        },
        update_channel: {
            support: "native",
            availability: "permission",
            permissions: ["MANAGE_CHANNELS"],
        },
        delete_channel: {
            support: "native",
            availability: "permission",
            permissions: ["MANAGE_CHANNELS"],
        },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "channel"] },
        member_joined: { support: "native" },
        member_left: { support: "native" },
        message_updated: { support: "native" },
        message_deleted: { support: "native" },
        reaction_added: { support: "native", note: "包括 emoji reaction 与 poll vote" },
        reaction_removed: { support: "native", note: "包括 emoji reaction 与 poll vote" },
        interaction: { support: "native" },
        native_dispatch: {
            support: "native",
            note: "所有未标准化 Gateway Dispatch 以 custom notice 和 raw_event 无损交付",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        embed: { support: "native", direction: "both" },
        channel: { support: "native", direction: "both" },
        reply: { support: "native", direction: "both" },
        discord_message: {
            support: "native",
            direction: "send",
            note: "直接传递 Discord v10 Create Message JSON 字段",
        },
        sticker: { support: "native", direction: "receive" },
    },
    transports: {
        gateway: { support: "native", mode: "websocket" },
        interactions: {
            support: "native",
            mode: "webhook",
            note: "复用 OneBots HTTP Host，不创建独立监听端口",
        },
        webhook_events: {
            support: "native",
            mode: "webhook",
            note: "接收 Discord 应用授权、Entitlement、Lobby 与 Social SDK 原生事件",
        },
        manual: {
            support: "native",
            mode: "native",
            note: "通过 ingestInteraction() 接入上游已验签的事件",
        },
    },
});
