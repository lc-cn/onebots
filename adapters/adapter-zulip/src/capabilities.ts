import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";
import { ZULIP_PLATFORM_ACTIONS } from "./platform-actions.js";

const permission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["Zulip 组织角色与频道权限"],
};
const platformActions = Object.fromEntries(
    [...ZULIP_PLATFORM_ACTIONS].map(action => [
        action,
        [
            "subscribe_channels",
            "unsubscribe_channels",
            "create_zulip_channel",
            "update_zulip_channel",
            "archive_channel",
            "unarchive_channel",
        ].includes(action)
            ? { ...permission }
            : { support: "native" as const },
    ]),
);

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
