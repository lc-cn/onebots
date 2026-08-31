import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    type AdapterCapabilityManifest,
    type CapabilityDescriptor,
} from "onebots";
import { DEFAULT_DISCORD_INTENTS } from "./intents.js";
import { DISCORD_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { DiscordConfig, GatewayIntentName } from "./types.js";

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
const soundboardWriteActions = new Set([
    "create_guild_soundboard_sound",
    "update_guild_soundboard_sound",
    "delete_guild_soundboard_sound",
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
    search_guild_messages: {
        support: "native",
        availability: "permission",
        permissions: ["READ_MESSAGE_HISTORY", "MESSAGE_CONTENT intent"],
    },
    set_voice_channel_status: {
        support: "native",
        availability: "permission",
        permissions: ["SET_VOICE_CHANNEL_STATUS", "MANAGE_CHANNELS（未连接频道时）"],
    },
    send_soundboard_sound: {
        support: "native",
        availability: "permission",
        permissions: ["SPEAK", "USE_SOUNDBOARD", "USE_EXTERNAL_SOUNDS（跨服务器时）"],
    },
};
const platformActions = definePlatformActionCapabilities(DISCORD_PLATFORM_ACTIONS, action => {
    if (autoModerationActions.has(action)) return manageGuild;
    if (scheduledEventWriteActions.has(action)) return manageEvents;
    if (emojiWriteActions.has(action)) return manageExpressions;
    if (soundboardWriteActions.has(action)) return manageExpressions;
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
        user_updated: { support: "native" },
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

type CapabilityScene = NonNullable<CapabilityDescriptor["scenes"]>[number];

/** 根据账号接收模式与 Identify intents 描述当前真正可达的 Discord 事件。 */
export function describeDiscordCapabilities(
    config: Pick<DiscordConfig, "intents" | "receive_mode">,
): AdapterCapabilityManifest {
    const mode = config.receive_mode ?? "gateway";
    if (mode !== "gateway") return describeDiscordHttpCapabilities(mode);

    const enabled = new Set<GatewayIntentName>(
        config.intents?.length ? config.intents : DEFAULT_DISCORD_INTENTS,
    );
    const events: Record<string, CapabilityDescriptor> = { ...discordCapabilities.events };
    const messageScenes: CapabilityScene[] = [];
    const missingMessageIntents: GatewayIntentName[] = [];
    if (enabled.has("DirectMessages")) messageScenes.push("private");
    else missingMessageIntents.push("DirectMessages");
    if (enabled.has("GuildMessages")) messageScenes.push("channel");
    else missingMessageIntents.push("GuildMessages");
    for (const event of ["message", "message_updated", "message_deleted"] as const) {
        events[event] = sceneLimitedDescriptor(
            messageScenes,
            missingMessageIntents,
            "消息事件",
            discordCapabilities.events[event],
        );
    }

    const memberDescriptor = enabled.has("GuildMembers")
        ? discordCapabilities.events.member_joined
        : missingIntentDescriptor(["GuildMembers"], "Guild 成员事件");
    events.member_joined = memberDescriptor;
    events.member_left = memberDescriptor;
    events.user_updated = memberDescriptor;

    const reactionScenes: CapabilityScene[] = [];
    const missingReactionIntents: GatewayIntentName[] = [];
    collectReactionScene(
        enabled,
        reactionScenes,
        missingReactionIntents,
        "private",
        "DirectMessageReactions",
        "DirectMessagePolls",
    );
    collectReactionScene(
        enabled,
        reactionScenes,
        missingReactionIntents,
        "channel",
        "GuildMessageReactions",
        "GuildMessagePolls",
    );
    for (const event of ["reaction_added", "reaction_removed"] as const) {
        events[event] = sceneLimitedDescriptor(
            reactionScenes,
            missingReactionIntents,
            "Reaction 与 Poll Vote 事件",
            discordCapabilities.events[event],
        );
    }

    const segments = { ...discordCapabilities.segments };
    if (enabled.has("GuildMessages") && !enabled.has("MessageContent")) {
        for (const segment of ["text", "image", "file", "audio", "video", "embed"] as const) {
            const descriptor = discordCapabilities.segments[segment];
            if (!descriptor) continue;
            segments[segment] = {
                ...descriptor,
                availability: "permission",
                permissions: ["MessageContent"],
                note: "发送与私信接收不受影响；Guild 消息中的用户正文、附件与 Embed 可能为空",
            };
        }
    }

    return defineAdapterCapabilities({
        actions: discordCapabilities.actions,
        events,
        segments,
        transports: discordCapabilities.transports,
    });
}

function describeDiscordHttpCapabilities(
    mode: Exclude<NonNullable<DiscordConfig["receive_mode"]>, "gateway">,
): AdapterCapabilityManifest {
    const events: Record<string, CapabilityDescriptor> = {};
    for (const event of Object.keys(discordCapabilities.events)) {
        const supported =
            (mode === "interactions" || mode === "manual") && event === "interaction"
                ? discordCapabilities.events.interaction
                : mode === "webhook_events" && event === "native_dispatch"
                  ? {
                        support: "native" as const,
                        note: "Discord Webhook Events 以结构化 custom notice 和 raw_event 无损交付",
                    }
                  : {
                        support: "unsupported" as const,
                        availability: "context" as const,
                        note: `${mode} 接收模式不会投递此类 Gateway 事件`,
                    };
        events[event] = supported;
    }
    return defineAdapterCapabilities({
        actions: discordCapabilities.actions,
        events,
        segments: discordCapabilities.segments,
        transports: discordCapabilities.transports,
    });
}

function collectReactionScene(
    enabled: ReadonlySet<GatewayIntentName>,
    scenes: CapabilityScene[],
    missing: GatewayIntentName[],
    scene: CapabilityScene,
    reactionIntent: GatewayIntentName,
    pollIntent: GatewayIntentName,
): void {
    const hasReaction = enabled.has(reactionIntent);
    const hasPoll = enabled.has(pollIntent);
    if (hasReaction || hasPoll) scenes.push(scene);
    if (!hasReaction) missing.push(reactionIntent);
    if (!hasPoll) missing.push(pollIntent);
}

function sceneLimitedDescriptor(
    scenes: readonly CapabilityScene[],
    missing: readonly GatewayIntentName[],
    label: string,
    complete: CapabilityDescriptor,
): CapabilityDescriptor {
    if (scenes.length === 0) return missingIntentDescriptor(missing, label);
    if (missing.length === 0) return { ...complete, scenes };
    return {
        ...complete,
        availability: "permission",
        scenes,
        permissions: missing,
        note: `${label}仅在当前账号已订阅的场景和类型中可接收；权限列表为缺少的 intent`,
    };
}

function missingIntentDescriptor(
    required: readonly GatewayIntentName[],
    label: string,
): CapabilityDescriptor {
    return {
        support: "unsupported",
        availability: "permission",
        permissions: required,
        note: `当前账号未订阅 ${label} 所需的 Discord Gateway intent`,
    };
}
