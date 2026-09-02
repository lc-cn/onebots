import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    restrictAdapterEventCapabilities,
    type AdapterCapabilityManifest,
    type CapabilityDescriptor,
} from "onebots";
import { INSTAGRAM_PLATFORM_ACTIONS } from "./platform-actions.js";
import {
    INSTAGRAM_EVENT_TYPES,
    INSTAGRAM_WEBHOOK_FIELDS,
    type InstagramConfig,
    type InstagramEventType,
} from "./types.js";

export { INSTAGRAM_EVENT_TYPES, INSTAGRAM_WEBHOOK_FIELDS };

const permission = (permissions: readonly string[], note?: string): CapabilityDescriptor => ({
    support: "native",
    availability: "permission",
    permissions,
    note,
});

const basic = permission(["instagram_business_basic"]);
const messaging = permission(
    ["instagram_business_manage_messages"],
    "仅可联系已主动开启会话的用户，并受标准消息窗口约束",
);
const conversations = permission(
    ["instagram_business_manage_messages"],
    "Requests 文件夹中 30 天未活跃会话不会返回；单次最多读取最近 20 条消息详情",
);

const platformActions = definePlatformActionCapabilities(INSTAGRAM_PLATFORM_ACTIONS, action => {
    if (action === "call_instagram_api") return permission(["目标 Graph edge 要求的 permission"]);
    if (action === "send_instagram_human_agent") {
        return permission(
            ["instagram_business_manage_messages", "Human Agent"],
            "仅限 7 天内由真实人工客服发送，不得用于自动化或无关内容",
        );
    }
    if (action === "send_instagram_private_reply") {
        return permission(
            ["instagram_business_manage_messages", "instagram_business_manage_comments"],
            "每条评论只能私信回复一次，须在评论后 7 天内发送",
        );
    }
    if (action.includes("welcome_message_flow")) return messaging;
    if (action.includes("profile")) return messaging;
    if (action.includes("conversation")) return conversations;
    if (action.includes("subscribed") || action.startsWith("subscribe_")) return messaging;
    return messaging;
});

/** Instagram Login 当前稳定接口的真实边界；Instagram Messaging 不支持群聊。 */
export const instagramCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { ...messaging, scenes: ["direct"] },
        get_message: { ...conversations, scenes: ["direct"] },
        get_message_history: { ...conversations, scenes: ["direct"] },
        get_login_info: basic,
        get_user_info: permission([
            "instagram_business_basic",
            "instagram_business_manage_messages",
        ]),
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
        message_deleted: { support: "native" },
        message_updated: { support: "native" },
        message_status: { support: "native" },
        reaction_added: { support: "native" },
        reaction_removed: { support: "native" },
        interaction: { support: "native" },
        custom: {
            support: "native",
            note: "unsupported message、referral、opt-in、handover、standby、comment 与其他 field/value 原样保留",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        reply: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        instagram_quick_replies: { support: "native", direction: "send" },
        instagram_quick_reply: { support: "native", direction: "receive" },
        instagram_referral: { support: "native", direction: "receive" },
        instagram_reply_context: { support: "native", direction: "receive" },
        instagram: { support: "native", direction: "send" },
        instagram_attachment: { support: "native", direction: "receive" },
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

const eventProjection: Readonly<Record<string, readonly InstagramEventType[]>> = {
    message: ["message"],
    message_deleted: ["message_deleted"],
    message_updated: ["message_edit"],
    message_status: ["message_echo", "read"],
    reaction_added: ["reaction"],
    reaction_removed: ["reaction"],
    interaction: ["postback"],
    custom: ["message_unsupported", "referral", "optin", "handover", "change", "unknown"],
};

const fieldEvents: Readonly<Record<string, readonly InstagramEventType[]>> = {
    messages: ["message", "message_echo", "message_deleted", "message_unsupported", "message_edit"],
    messaging_postbacks: ["postback"],
    messaging_seen: ["read"],
    messaging_handover: ["handover"],
    messaging_referral: ["referral"],
    messaging_optins: ["optin"],
    message_reactions: ["reaction"],
    standby: ["unknown"],
    comments: ["change"],
    live_comments: ["change"],
    mentions: ["change"],
    story_insights: ["change"],
};

export function describeInstagramCapabilities(
    config: Pick<
        InstagramConfig,
        "declared_permissions" | "event_types" | "receive_mode" | "subscribed_fields"
    >,
): AdapterCapabilityManifest {
    const configuredEvents = new Set<InstagramEventType>(
        config.event_types?.length ? config.event_types : INSTAGRAM_EVENT_TYPES,
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
        instagramCapabilities,
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
    for (const [action, descriptor] of Object.entries(actions)) {
        if (action === "call_instagram_api") continue;
        const required = descriptor.permissions || [];
        if (!required.length) continue;
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
