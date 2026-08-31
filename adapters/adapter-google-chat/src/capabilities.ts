import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    restrictAdapterEventCapabilities,
    type AdapterCapabilityManifest,
    type CapabilityDescriptor,
} from "onebots";
import { GOOGLE_CHAT_PLATFORM_ACTIONS } from "./platform-actions.js";
import {
    GOOGLE_CHAT_EVENT_TYPES,
    GOOGLE_CHAT_INTERACTION_TYPES,
    GOOGLE_CHAT_WORKSPACE_EVENT_TYPES,
} from "./event-types.js";
import type { GoogleChatConfig } from "./types.js";

export {
    GOOGLE_CHAT_EVENT_TYPES,
    GOOGLE_CHAT_INTERACTION_TYPES,
    GOOGLE_CHAT_WORKSPACE_EVENT_TYPES,
};

const permission = (permissions: readonly string[], note?: string): CapabilityDescriptor => ({
    support: "native",
    availability: "permission",
    permissions,
    note,
});

const messagePermission = permission(["chat.bot 或 chat.messages"]);
const historyPermission = permission([
    "chat.messages.readonly / chat.messages 或管理员批准的 chat.app.messages.readonly",
]);
const spacePermission = permission(["chat.spaces 或管理员批准的 chat.app.spaces"]);
const membershipPermission = permission(["chat.memberships 或管理员批准的 chat.app.memberships"]);

const platformActions = definePlatformActionCapabilities(GOOGLE_CHAT_PLATFORM_ACTIONS, action => {
    if (action === "call_google_chat_api") {
        return permission(["目标 Google Chat REST 方法要求的 OAuth scope"]);
    }
    if (["setup_google_chat_space", "create_google_chat_space"].includes(action)) {
        return permission(["chat.spaces.create 或 chat.spaces"]);
    }
    if (action === "get_google_chat_availability") {
        return permission(["chat.users.availability.readonly 或 chat.users.availability"]);
    }
    if (action.startsWith("mark_google_chat_")) {
        return permission(["chat.users.availability（仅当前用户）"]);
    }
    if (action === "find_google_chat_group_chats") {
        return permission(["chat.memberships.readonly 或 chat.memberships（仅用户身份）"]);
    }
    if (action.endsWith("_read_state")) {
        return permission(["chat.users.readstate.readonly 或 chat.users.readstate"]);
    }
    if (action === "list_google_chat_space_events") {
        return permission(["事件资源对应的 Chat read-only scope"]);
    }
    return messagePermission;
});

/** Google Chat REST v1 与 Google Workspace Events API 的稳定能力边界。 */
export const googleChatCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["group", "direct"] },
        delete_message: messagePermission,
        get_message: messagePermission,
        get_message_history: historyPermission,
        update_message: messagePermission,
        mark_message_as_read: permission(["chat.users.readstate 或 chat.users"]),
        get_login_info: { support: "native" },
        get_user_info: {
            support: "native",
            availability: "context",
            note: "Google Chat 没有通用 users.get；返回事件或 membership 缓存中的用户",
        },
        create_user_channel: { support: "native", availability: "permission" },
        get_group_list: { support: "native" },
        get_group_info: { support: "native" },
        set_group_name: spacePermission,
        leave_group: permission([
            "chat.memberships（用户）或 chat.memberships.app（应用自行退出）",
        ]),
        get_group_member_list: { support: "native" },
        get_group_member_info: { support: "native" },
        invite_group_member: membershipPermission,
        kick_group_member: membershipPermission,
        send_group_message_reaction: {
            ...messagePermission,
            availability: "context",
            note: "删除 reaction 需要先观察或创建对应 reaction resource",
        },
        upload_file: permission(["chat.messages.create 或 chat.messages（仅用户身份）"]),
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["group", "direct"] },
        message_updated: { support: "native" },
        message_deleted: { support: "native" },
        reaction_added: { support: "native" },
        reaction_removed: { support: "native" },
        member_joined: { support: "native" },
        member_left: { support: "native" },
        user_updated: { support: "native" },
        channel_updated: { support: "native" },
        message_status: { support: "native" },
        custom: {
            support: "native",
            note: "卡片、命令、dialog 与未投影字段完整保留在 raw_event/extensions",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "send" },
        emoji: { support: "native", direction: "send" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        google_chat_card: { support: "native", direction: "receive" },
        thread: { support: "native", direction: "receive" },
    },
    transports: {
        interaction_http: {
            support: "native",
            mode: "webhook",
            note: "校验 Google Chat OIDC/JWT，可返回同步结构化响应",
        },
        pubsub_push: {
            support: "native",
            mode: "webhook",
            note: "校验 Pub/Sub OIDC push 并展开 Workspace batch event",
        },
        manual: {
            support: "native",
            mode: "native",
            note: "ingest(rawEvent) 复用相同 Client、去重和事件投影管线",
        },
    },
});

const eventProjection: Readonly<Record<string, readonly string[]>> = {
    message: ["MESSAGE", "google.workspace.chat.message.v1.created"],
    message_updated: ["google.workspace.chat.message.v1.updated"],
    message_deleted: ["google.workspace.chat.message.v1.deleted"],
    reaction_added: ["google.workspace.chat.reaction.v1.created"],
    reaction_removed: ["google.workspace.chat.reaction.v1.deleted"],
    member_joined: ["ADDED_TO_SPACE", "google.workspace.chat.membership.v1.created"],
    member_left: ["REMOVED_FROM_SPACE", "google.workspace.chat.membership.v1.deleted"],
    user_updated: ["google.workspace.chat.availability.v1.updated"],
    channel_updated: [
        "google.workspace.chat.space.v1.updated",
        "google.workspace.chat.space.v1.deleted",
    ],
    message_status: [
        "google.workspace.chat.spaceReadState.v1.updated",
        "google.workspace.chat.threadReadState.v1.updated",
    ],
};

export function describeGoogleChatCapabilities(
    config: Pick<GoogleChatConfig, "auth_mode" | "event_types" | "oauth_scopes" | "receive_mode">,
): AdapterCapabilityManifest {
    const mode = config.receive_mode || "interaction-http";
    const modeTypes =
        mode === "interaction-http"
            ? GOOGLE_CHAT_INTERACTION_TYPES
            : mode === "pubsub-push"
              ? GOOGLE_CHAT_WORKSPACE_EVENT_TYPES
              : GOOGLE_CHAT_EVENT_TYPES;
    const configured = new Set(config.event_types?.length ? config.event_types : modeTypes);
    const enabled = new Set<string>(modeTypes.filter(type => configured.has(type)));
    const available = new Set<string>();
    for (const [event, sources] of Object.entries(eventProjection)) {
        if (sources.some(source => enabled.has(source))) available.add(event);
    }
    if (
        [...enabled].some(
            source =>
                !Object.values(eventProjection).some(projected => projected.includes(source)) ||
                ["CARD_CLICKED", "WIDGET_UPDATED", "APP_COMMAND"].includes(source),
        )
    ) {
        available.add("custom");
    }
    const eventManifest = restrictAdapterEventCapabilities(
        googleChatCapabilities,
        available,
        event => {
            return `event_types 未包含可生成 ${event} 的 Google Chat 事件`;
        },
    );
    return restrictKnownActionScopes(eventManifest, config);
}

const SCOPE = "https://www.googleapis.com/auth/";
const actionScopes: Readonly<Record<string, readonly string[]>> = {
    send_message: ["chat.bot", "chat.messages"],
    delete_message: ["chat.bot", "chat.messages"],
    get_message: [
        "chat.bot",
        "chat.messages",
        "chat.messages.readonly",
        "chat.app.messages.readonly",
    ],
    get_message_history: ["chat.messages", "chat.messages.readonly", "chat.app.messages.readonly"],
    update_message: ["chat.bot", "chat.messages"],
    mark_message_as_read: ["chat.users.readstate"],
    create_user_channel: ["chat.bot", "chat.spaces", "chat.spaces.readonly"],
    get_group_list: ["chat.bot", "chat.spaces", "chat.spaces.readonly", "chat.app.spaces.readonly"],
    get_group_info: ["chat.bot", "chat.spaces", "chat.spaces.readonly", "chat.app.spaces.readonly"],
    set_group_name: ["chat.spaces", "chat.app.spaces"],
    leave_group: ["chat.memberships", "chat.memberships.app"],
    get_group_member_list: [
        "chat.bot",
        "chat.memberships",
        "chat.memberships.readonly",
        "chat.app.memberships.readonly",
    ],
    get_group_member_info: [
        "chat.bot",
        "chat.memberships",
        "chat.memberships.readonly",
        "chat.app.memberships.readonly",
    ],
    invite_group_member: ["chat.memberships", "chat.app.memberships"],
    kick_group_member: ["chat.memberships", "chat.app.memberships"],
    send_group_message_reaction: ["chat.bot", "chat.messages.reactions", "chat.messages"],
    upload_file: ["chat.messages.create", "chat.messages"],
    find_google_chat_direct_message: ["chat.bot", "chat.spaces", "chat.spaces.readonly"],
    find_google_chat_group_chats: ["chat.memberships", "chat.memberships.readonly"],
    setup_google_chat_space: ["chat.spaces", "chat.spaces.create"],
    create_google_chat_space: ["chat.spaces", "chat.spaces.create"],
    delete_google_chat_space: ["chat.spaces", "chat.app.spaces"],
    get_google_chat_availability: ["chat.users.availability", "chat.users.availability.readonly"],
    mark_google_chat_active: ["chat.users.availability"],
    mark_google_chat_away: ["chat.users.availability"],
    mark_google_chat_do_not_disturb: ["chat.users.availability"],
    get_google_chat_space_read_state: ["chat.users.readstate", "chat.users.readstate.readonly"],
    get_google_chat_thread_read_state: ["chat.users.readstate", "chat.users.readstate.readonly"],
    list_google_chat_reactions: [
        "chat.bot",
        "chat.messages.reactions",
        "chat.messages.reactions.readonly",
        "chat.messages.readonly",
    ],
    send_google_chat_rich_message: ["chat.bot", "chat.messages"],
};

function restrictKnownActionScopes(
    manifest: AdapterCapabilityManifest,
    config: Pick<GoogleChatConfig, "auth_mode" | "oauth_scopes">,
): AdapterCapabilityManifest {
    const declared = config.oauth_scopes?.length
        ? new Set(config.oauth_scopes)
        : (config.auth_mode || "service-account") === "service-account"
          ? new Set([`${SCOPE}chat.bot`])
          : undefined;
    if (!declared) return manifest;
    let restricted = false;
    const actions = { ...manifest.actions };
    for (const [action, required] of Object.entries(actionScopes)) {
        if (required.some(scope => declared.has(`${SCOPE}${scope}`))) continue;
        restricted = true;
        actions[action] = {
            support: "unsupported",
            availability: "permission",
            permissions: required.map(scope => `${SCOPE}${scope}`),
            note: "当前账号声明的 oauth_scopes 不包含此动作所需权限",
        };
    }
    if (!restricted) return manifest;
    return defineAdapterCapabilities({
        actions,
        events: manifest.events,
        segments: manifest.segments,
        transports: manifest.transports,
    });
}
