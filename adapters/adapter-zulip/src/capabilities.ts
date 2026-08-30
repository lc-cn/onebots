import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { ZULIP_BOT_CREDENTIAL_ACTIONS } from "./bot-actions.js";
import { ZULIP_CHANNEL_FOLDER_MUTATION_ACTIONS } from "./channel-folder-actions.js";
import { ZULIP_DOMAIN_MUTATION_ACTIONS } from "./domain-actions.js";
import { ZULIP_DATA_EXPORT_MUTATION_ACTIONS } from "./data-export-actions.js";
import { ZULIP_EMOJI_MUTATION_ACTIONS } from "./emoji-actions.js";
import { ZULIP_INVITATION_ACTIONS } from "./invitation-actions.js";
import { ZULIP_LINKIFIER_MUTATION_ACTIONS } from "./linkifier-actions.js";
import { ZULIP_OWN_PROFILE_PERMISSION_ACTIONS } from "./own-profile-actions.js";
import { ZULIP_PLATFORM_ACTIONS } from "./platform-actions.js";
import { ZULIP_PREFERENCE_PERMISSION_ACTIONS } from "./preference-actions.js";
import { ZULIP_PLAYGROUND_MUTATION_ACTIONS } from "./playground-actions.js";
import { ZULIP_PROFILE_FIELD_MUTATION_ACTIONS } from "./profile-field-actions.js";
import { ZULIP_USER_MUTATION_ACTIONS } from "./user-actions.js";
import { ZULIP_USER_GROUP_MUTATION_ACTIONS } from "./user-group-actions.js";

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
    "subscribe_channels",
    "unsubscribe_channels",
    "create_zulip_channel",
    "update_zulip_channel",
    "archive_channel",
    "unarchive_channel",
]);
const platformActions = definePlatformActionCapabilities(ZULIP_PLATFORM_ACTIONS, action => {
    if (ZULIP_OWN_PROFILE_PERMISSION_ACTIONS.has(action)) return { ...ownProfilePermission };
    if (ZULIP_CHANNEL_FOLDER_MUTATION_ACTIONS.has(action)) return { ...administratorPermission };
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
        channel_folder_created: { support: "native" },
        channel_folder_updated: { support: "native" },
        channel_folders_reordered: { support: "native" },
        navigation_view_created: { support: "native" },
        navigation_view_updated: { support: "native" },
        navigation_view_removed: { support: "native" },
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
