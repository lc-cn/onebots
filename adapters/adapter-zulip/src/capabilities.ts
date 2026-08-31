import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    restrictAdapterEventCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { ZULIP_BOT_CREDENTIAL_ACTIONS } from "./bot-actions.js";
import { ZULIP_CHANNEL_FOLDER_MUTATION_ACTIONS } from "./channel-folder-actions.js";
import {
    ZULIP_CHANNEL_PERMISSION_ACTIONS,
    ZULIP_DEFAULT_CHANNEL_ADMIN_ACTIONS,
} from "./channel-actions.js";
import { ZULIP_DOMAIN_MUTATION_ACTIONS } from "./domain-actions.js";
import { ZULIP_DATA_EXPORT_MUTATION_ACTIONS } from "./data-export-actions.js";
import { ZULIP_EMOJI_MUTATION_ACTIONS } from "./emoji-actions.js";
import { ZULIP_INVITATION_ACTIONS } from "./invitation-actions.js";
import { ZULIP_LINKIFIER_MUTATION_ACTIONS } from "./linkifier-actions.js";
import {
    ZULIP_OWNER_DESTRUCTIVE_ACTIONS,
    ZULIP_SELF_CREDENTIAL_ACTIONS,
    ZULIP_SELF_DESTRUCTIVE_ACTIONS,
} from "./lifecycle-actions.js";
import { ZULIP_OWN_PROFILE_PERMISSION_ACTIONS } from "./own-profile-actions.js";
import { ZULIP_PLATFORM_ACTIONS } from "./platform-actions.js";
import { ZULIP_PREFERENCE_PERMISSION_ACTIONS } from "./preference-actions.js";
import { ZULIP_PLAYGROUND_MUTATION_ACTIONS } from "./playground-actions.js";
import { ZULIP_PROFILE_FIELD_MUTATION_ACTIONS } from "./profile-field-actions.js";
import { ZULIP_USER_MUTATION_ACTIONS } from "./user-actions.js";
import { ZULIP_USER_GROUP_MUTATION_ACTIONS } from "./user-group-actions.js";
import { ZULIP_DEFAULT_EVENT_TYPES } from "./event-metadata.js";
import type { ZulipConfig, ZulipEventType } from "./types.js";

const permission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["Zulip 组织角色与频道权限"],
};
const ownProfilePermission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["Zulip 组织资料与头像修改策略"],
};
const administratorPermission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["Zulip 组织管理员"],
};
const ownerPermission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["Zulip 组织 Owner"],
    note: "破坏性操作：成功后组织立即停用，并可能进入永久删除倒计时",
};
const permissionActions: ReadonlySet<string> = new Set([
    ...ZULIP_USER_GROUP_MUTATION_ACTIONS,
    ...ZULIP_USER_MUTATION_ACTIONS,
    ...ZULIP_INVITATION_ACTIONS,
    ...ZULIP_BOT_CREDENTIAL_ACTIONS,
    ...ZULIP_DOMAIN_MUTATION_ACTIONS,
    ...ZULIP_DATA_EXPORT_MUTATION_ACTIONS,
    ...ZULIP_EMOJI_MUTATION_ACTIONS,
    ...ZULIP_PREFERENCE_PERMISSION_ACTIONS,
    ...ZULIP_PLAYGROUND_MUTATION_ACTIONS,
    ...ZULIP_PROFILE_FIELD_MUTATION_ACTIONS,
    ...ZULIP_LINKIFIER_MUTATION_ACTIONS,
    ...ZULIP_CHANNEL_PERMISSION_ACTIONS,
    "subscribe_channels",
    "unsubscribe_channels",
]);
const platformActions = definePlatformActionCapabilities(ZULIP_PLATFORM_ACTIONS, action => {
    if (ZULIP_OWN_PROFILE_PERMISSION_ACTIONS.has(action)) return { ...ownProfilePermission };
    if (ZULIP_CHANNEL_FOLDER_MUTATION_ACTIONS.has(action)) return { ...administratorPermission };
    if (ZULIP_DEFAULT_CHANNEL_ADMIN_ACTIONS.has(action)) return { ...administratorPermission };
    if (ZULIP_OWNER_DESTRUCTIVE_ACTIONS.has(action)) return { ...ownerPermission };
    if (ZULIP_SELF_DESTRUCTIVE_ACTIONS.has(action)) {
        return { support: "native", note: "破坏性操作：成功后当前账号立即停用" };
    }
    if (ZULIP_SELF_CREDENTIAL_ACTIONS.has(action)) {
        return {
            support: "native",
            note: "敏感操作：成功后必须立即用返回的新 API Key 重配 Client",
        };
    }
    return permissionActions.has(action) ? { ...permission } : { support: "native" };
});

/** Zulip REST API 与 Event Queue 的真实能力。 */
export const zulipCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "direct", "group", "channel"] },
        delete_message: permission,
        get_message: { support: "native" },
        get_message_history: { support: "native" },
        update_message: permission,
        mark_message_as_read: { support: "native" },
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        get_group_list: { support: "emulated", note: "将 Zulip Channel 投影为通用群组" },
        get_group_info: { support: "emulated", note: "将 Zulip Channel 投影为通用群组" },
        set_group_name: permission,
        leave_group: { support: "native" },
        get_group_member_list: { support: "native" },
        get_group_member_info: { support: "native" },
        invite_group_member: permission,
        kick_group_member: permission,
        upload_file: { support: "native" },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["private", "direct", "group", "channel"] },
        message_updated: { support: "native" },
        message_deleted: { support: "native" },
        message_flags_updated: { support: "native" },
        reaction_added: { support: "native" },
        reaction_removed: { support: "native" },
        user_added: { support: "native" },
        user_updated: { support: "native" },
        user_removed: { support: "native" },
        user_group_created: { support: "native" },
        user_group_updated: { support: "native" },
        user_group_deactivated: { support: "native" },
        user_group_reactivated: { support: "native" },
        user_group_member_added: { support: "native" },
        user_group_member_removed: { support: "native" },
        user_group_subgroup_added: { support: "native" },
        user_group_subgroup_removed: { support: "native" },
        channel_created: { support: "native" },
        channel_updated: { support: "native" },
        channel_deleted: { support: "native" },
        channel_subscription_added: { support: "native" },
        channel_subscription_removed: { support: "native" },
        channel_subscription_updated: { support: "native" },
        channel_subscriber_added: { support: "native" },
        channel_subscriber_removed: { support: "native" },
        default_channels_updated: { support: "native" },
        default_user_settings_updated: { support: "native" },
        channel_folder_created: { support: "native" },
        channel_folder_updated: { support: "native" },
        channel_folders_reordered: { support: "native" },
        navigation_view_created: { support: "native" },
        navigation_view_updated: { support: "native" },
        navigation_view_removed: { support: "native" },
        attachment_created: { support: "native" },
        attachment_updated: { support: "native" },
        attachment_removed: { support: "native" },
        emoji_created: { support: "native" },
        emoji_updated: { support: "native" },
        heartbeat: { support: "native" },
        raw_event: { support: "native" },
        custom: { support: "native" },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "send" },
        emoji: { support: "native", direction: "send" },
        image: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
    },
    transports: {
        event_queue: { support: "native", mode: "polling" },
        manual: {
            support: "native",
            mode: "native",
            note: "通过 ZulipClient.ingest() 接入已有 Event Queue 或事件代理",
        },
    },
});

const zulipEventTypes = {
    message: ["message"],
    message_updated: ["update_message"],
    message_deleted: ["delete_message"],
    message_flags_updated: ["update_message_flags"],
    reaction_added: ["reaction"],
    reaction_removed: ["reaction"],
    user_added: ["realm_user"],
    user_updated: ["realm_user", "user_settings", "presence", "user_status"],
    user_removed: ["realm_user"],
    user_group_created: ["user_group"],
    user_group_updated: ["user_group"],
    user_group_deactivated: ["user_group"],
    user_group_reactivated: ["user_group"],
    user_group_member_added: ["user_group"],
    user_group_member_removed: ["user_group"],
    user_group_subgroup_added: ["user_group"],
    user_group_subgroup_removed: ["user_group"],
    channel_created: ["stream"],
    channel_updated: ["stream"],
    channel_deleted: ["stream"],
    channel_subscription_added: ["subscription"],
    channel_subscription_removed: ["subscription"],
    channel_subscription_updated: ["subscription"],
    channel_subscriber_added: ["subscription"],
    channel_subscriber_removed: ["subscription"],
    default_channels_updated: ["default_streams", "default_stream_groups"],
    default_user_settings_updated: ["realm_user_settings_defaults"],
    channel_folder_created: ["channel_folder"],
    channel_folder_updated: ["channel_folder"],
    channel_folders_reordered: ["channel_folder"],
    navigation_view_created: ["navigation_view"],
    navigation_view_updated: ["navigation_view"],
    navigation_view_removed: ["navigation_view"],
    attachment_created: ["attachment"],
    attachment_updated: ["attachment"],
    attachment_removed: ["attachment"],
    emoji_created: ["realm_emoji"],
    emoji_updated: ["realm_emoji"],
    heartbeat: ["heartbeat"],
} as const satisfies Partial<Record<string, readonly ZulipEventType[]>>;

/** 根据当前账号注册 Event Queue 时提交的 event_types 收窄事件能力。 */
export function describeZulipCapabilities(
    config: Pick<ZulipConfig, "event_queue" | "receive_mode">,
): AdapterCapabilityManifest {
    // manual 模式的订阅由外部 Event Queue 管理，本地配置无法可靠推断。
    if (config.receive_mode === "manual") return zulipCapabilities;
    const configured = config.event_queue?.event_types;
    const enabled = new Set<ZulipEventType>(
        configured?.length ? configured : ZULIP_DEFAULT_EVENT_TYPES,
    );
    const available = new Set<string>(["raw_event", "custom"]);
    for (const [event, eventTypes] of Object.entries(zulipEventTypes)) {
        if (eventTypes.some(eventType => enabled.has(eventType))) available.add(event);
    }
    return restrictAdapterEventCapabilities(zulipCapabilities, available, event => {
        const eventTypes = zulipEventTypes[event as keyof typeof zulipEventTypes];
        return eventTypes
            ? `event_queue.event_types 未订阅可生成此事件的类型：${eventTypes.join(", ")}`
            : "当前 Event Queue 订阅不会生成此 canonical 事件";
    });
}
