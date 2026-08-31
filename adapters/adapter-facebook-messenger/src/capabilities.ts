import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    restrictAdapterEventCapabilities,
    type AdapterCapabilityManifest,
    type CapabilityDescriptor,
} from "onebots";
import { FACEBOOK_MESSENGER_PLATFORM_ACTIONS } from "./platform-actions.js";
import {
    FACEBOOK_MESSENGER_EVENT_TYPES,
    FACEBOOK_MESSENGER_WEBHOOK_FIELDS,
    type FacebookMessengerConfig,
    type FacebookMessengerEventType,
} from "./types.js";

export { FACEBOOK_MESSENGER_EVENT_TYPES };

export { FACEBOOK_MESSENGER_WEBHOOK_FIELDS };

const permission = (permissions: readonly string[], note?: string): CapabilityDescriptor => ({
    support: "native",
    availability: "permission",
    permissions,
    note,
});

const messaging = permission(
    ["pages_messaging"],
    "收件人须在标准 24 小时消息窗口内，或调用方须使用获准的 MESSAGE_TAG",
);
const conversations = permission([
    "pages_messaging",
    "pages_manage_metadata",
    "pages_read_engagement",
]);

const actionPermissions: Readonly<Record<string, readonly string[]>> = {
    send_message: ["pages_messaging"],
    get_message: ["pages_messaging", "pages_read_engagement"],
    get_message_history: ["pages_messaging", "pages_manage_metadata", "pages_read_engagement"],
    mark_message_as_read: ["pages_messaging"],
    get_user_info: ["pages_messaging"],
    upload_file: ["pages_messaging"],
    send_facebook_messenger_native: ["pages_messaging"],
    send_facebook_messenger_sender_action: ["pages_messaging"],
    list_facebook_messenger_conversations: [
        "pages_messaging",
        "pages_manage_metadata",
        "pages_read_engagement",
    ],
    find_facebook_messenger_conversation: [
        "pages_messaging",
        "pages_manage_metadata",
        "pages_read_engagement",
    ],
    get_facebook_messenger_conversation: [
        "pages_messaging",
        "pages_manage_metadata",
        "pages_read_engagement",
    ],
    subscribe_facebook_messenger_page: ["pages_manage_metadata"],
    get_facebook_messenger_subscribed_apps: ["pages_manage_metadata"],
    search_facebook_messenger_template_library: ["page_utility_messaging"],
    list_facebook_messenger_utility_templates: ["page_utility_messaging"],
    create_facebook_messenger_utility_template: ["page_utility_messaging"],
    send_facebook_messenger_utility_template: ["page_utility_messaging"],
};

const platformActions = definePlatformActionCapabilities(
    FACEBOOK_MESSENGER_PLATFORM_ACTIONS,
    action => {
        if (action === "call_facebook_messenger_api") {
            return permission(["目标 Graph edge 要求的 Page permission"]);
        }
        if (action.includes("profile")) return messaging;
        if (action.includes("conversation") && !action.startsWith("moderate")) {
            return conversations;
        }
        if (action.includes("subscribed") || action.startsWith("subscribe_")) {
            return permission(["pages_manage_metadata"]);
        }
        if (action.includes("utility_template") || action.includes("template_library")) {
            return permission(["page_utility_messaging"]);
        }
        return messaging;
    },
);

/** Messenger Platform 当前稳定接口的真实能力边界；仅存在一对一 PSID 会话。 */
export const facebookMessengerCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { ...messaging, scenes: ["direct"] },
        get_message: { ...conversations, scenes: ["direct"] },
        get_message_history: { ...conversations, scenes: ["direct"] },
        mark_message_as_read: { ...messaging, scenes: ["direct"] },
        get_login_info: { support: "native" },
        get_user_info: messaging,
        upload_file: { ...messaging, scenes: ["direct"] },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["direct"] },
        message_updated: { support: "native" },
        message_status: { support: "native" },
        reaction_added: { support: "native" },
        reaction_removed: { support: "native" },
        interaction: { support: "native" },
        custom: {
            support: "native",
            note: "referral、opt-in、handover、policy、feedback、standby 与 Page change 完整保留",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        reply: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        location: { support: "native", direction: "receive" },
        messenger_quick_replies: { support: "native", direction: "send" },
        messenger_quick_reply: { support: "native", direction: "receive" },
        messenger_referral: { support: "native", direction: "receive" },
        facebook_messenger: { support: "native", direction: "send" },
        messenger_attachment: { support: "native", direction: "receive" },
    },
    transports: {
        webhook: {
            support: "native",
            mode: "webhook",
            note: "GET challenge、精确 raw-body SHA256、batch 展开与可靠去重",
        },
        manual: {
            support: "native",
            mode: "native",
            note: "ingest(rawEvent) 与已有 Host 共用 Client 和事件投影",
        },
    },
});

const eventProjection: Readonly<Record<string, readonly FacebookMessengerEventType[]>> = {
    message: ["message"],
    message_updated: ["message_edit"],
    message_status: ["message_echo", "delivery", "read"],
    reaction_added: ["reaction"],
    reaction_removed: ["reaction"],
    interaction: ["postback"],
    custom: [
        "referral",
        "optin",
        "account_linking",
        "handover",
        "policy_enforcement",
        "feedback",
        "game_play",
        "change",
        "unknown",
    ],
};

const fieldEvents: Readonly<Record<string, readonly FacebookMessengerEventType[]>> = {
    messages: ["message"],
    message_echoes: ["message_echo"],
    message_edits: ["message_edit"],
    message_deliveries: ["delivery"],
    message_reads: ["read"],
    message_reactions: ["reaction"],
    messaging_postbacks: ["postback"],
    messaging_referrals: ["referral"],
    messaging_optins: ["optin"],
    messaging_account_linking: ["account_linking"],
    messaging_handovers: ["handover"],
    messaging_policy_enforcement: ["policy_enforcement"],
    messaging_feedback: ["feedback"],
    response_feedback: ["feedback"],
    messaging_game_plays: ["game_play"],
    messenger_template_status_update: ["change"],
    send_cart: ["unknown"],
    standby: ["unknown"],
};

export function describeFacebookMessengerCapabilities(
    config: Pick<
        FacebookMessengerConfig,
        "declared_permissions" | "event_types" | "receive_mode" | "subscribed_fields"
    >,
): AdapterCapabilityManifest {
    const configuredEvents = new Set<FacebookMessengerEventType>(
        config.event_types?.length ? config.event_types : FACEBOOK_MESSENGER_EVENT_TYPES,
    );
    if (config.subscribed_fields?.length) {
        const fromFields = new Set(
            config.subscribed_fields.flatMap(field => fieldEvents[field] || ["unknown"]),
        );
        for (const event of configuredEvents) {
            if (!fromFields.has(event)) configuredEvents.delete(event);
        }
    }
    const enabledCanonical = new Set<string>();
    for (const [canonical, sources] of Object.entries(eventProjection)) {
        if (sources.some(source => configuredEvents.has(source))) enabledCanonical.add(canonical);
    }
    let manifest = restrictAdapterEventCapabilities(
        facebookMessengerCapabilities,
        enabledCanonical,
        event => `当前 event_types/subscribed_fields 不会生成 ${event}`,
    );
    if (config.receive_mode === "manual") {
        manifest = {
            ...manifest,
            transports: {
                ...manifest.transports,
                webhook: {
                    support: "unsupported",
                    availability: "context",
                    mode: "webhook",
                    note: "当前 receive_mode 为 manual",
                },
            },
        };
    }
    return restrictDeclaredPermissions(manifest, config.declared_permissions);
}

function restrictDeclaredPermissions(
    manifest: AdapterCapabilityManifest,
    permissions: readonly string[] | undefined,
): AdapterCapabilityManifest {
    if (!permissions?.length) return manifest;
    const declared = new Set(permissions);
    const actions = { ...manifest.actions };
    for (const [action, required] of Object.entries(actionPermissions)) {
        if (required.every(permissionName => declared.has(permissionName))) continue;
        actions[action] = {
            support: "unsupported",
            availability: "permission",
            permissions: required,
            note: "declared_permissions 未包含该动作要求的全部权限",
        };
    }
    return { ...manifest, actions };
}
