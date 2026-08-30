import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    type AdapterCapabilityManifest,
    type CapabilityDescriptor,
} from "onebots";
import { QQ_PLATFORM_ACTIONS } from "./platform-actions.js";

const manageGuild: CapabilityDescriptor = {
    support: "native",
    availability: "permission",
    permissions: ["guild.manage"],
};

const manageBotUi: CapabilityDescriptor = {
    support: "native",
    availability: "permission",
    permissions: ["bot.ui.manage"],
};

const manageGuildActions = new Set([
    "approve_group_join_request",
    "get_group_join_requests",
    "get_group_restrict_chat",
    "set_group_restrict_chat",
    "get_group_join_approval_strategies",
    "create_group_join_approval_strategy",
    "update_group_join_approval_strategy",
    "delete_group_join_approval_strategy",
    "execute_group_join_approval_strategy",
    "update_group_join_approval_whitelist",
    "kick_guild_member",
    "mute_guild_member",
    "mute_guild",
    "create_guild_role",
    "update_guild_role",
    "delete_guild_role",
    "add_guild_member_role",
    "remove_guild_member_role",
    "set_channel_announce",
    "pin_channel_message",
    "unpin_channel_message",
    "create_schedule",
    "update_schedule",
    "delete_schedule",
    "delete_thread",
    "control_channel_audio",
    "put_channel_microphone",
    "delete_channel_microphone",
    "update_channel_permission_of_role",
    "update_channel_member_permission",
    "demand_guild_api_permission",
]);
const manageBotUiActions = new Set([
    "update_bot_menu",
    "create_bot_panel",
    "update_bot_panel",
    "delete_bot_panel",
    "publish_bot_panel",
]);
const platformActions = definePlatformActionCapabilities(QQ_PLATFORM_ACTIONS, action => {
    if (manageGuildActions.has(action)) return manageGuild;
    if (manageBotUiActions.has(action)) return manageBotUi;
    if (action === "send_wakeup" || action === "send_typing") {
        return { support: "native", scenes: ["private"] };
    }
    return { support: "native" };
});

/** 腾讯 QQ 官方 SDK 与 OpenAPI 实际可执行能力。 */
export const qqCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        ...platformActions,
        send_message: { support: "native", scenes: ["private", "group", "direct", "channel"] },
        delete_message: { support: "native", scenes: ["private", "group", "direct", "channel"] },
        get_message: { support: "native", scenes: ["direct", "channel"] },
        get_login_info: { support: "native" },
        get_group_info: { support: "native", scenes: ["group"] },
        get_guild_info: { support: "native" },
        get_guild_list: { support: "native" },
        get_guild_member_info: { support: "native" },
        get_guild_member_list: { support: "native" },
        get_channel_info: { support: "native" },
        get_channel_list: { support: "native" },
        create_channel: manageGuild,
        update_channel: manageGuild,
        delete_channel: manageGuild,
        upload_file: { support: "native", scenes: ["private", "group"] },
        create_user_channel: { support: "native", scenes: ["direct"] },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group", "direct", "channel"] },
        friend_add: { support: "native", scenes: ["private"] },
        friend_remove: { support: "native", scenes: ["private"] },
        group_increase: { support: "native", scenes: ["group"] },
        group_decrease: { support: "native", scenes: ["group"] },
        member_joined: { support: "native", scenes: ["group", "channel"] },
        user_updated: { support: "native", scenes: ["group", "channel"] },
        member_left: { support: "native", scenes: ["group", "channel"] },
        message_status: {
            support: "native",
            scenes: ["private", "group", "direct", "channel"],
        },
        message_deleted: { support: "native", scenes: ["direct", "channel"] },
        reaction_added: { support: "native", scenes: ["channel"] },
        reaction_removed: { support: "native", scenes: ["channel"] },
        interaction: { support: "native" },
        group_join_request: { support: "native", scenes: ["group"] },
        native_dispatch: {
            support: "native",
            note: "频道、Guild、论坛、音频及未来 Gateway 事件以结构化 custom notice 和 raw_event 无损交付",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "both" },
        face: { support: "native", direction: "send" },
        image: { support: "native", direction: "both" },
        reply: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        markdown: { support: "native", direction: "send" },
        ark: { support: "native", direction: "send" },
        embed: { support: "native", direction: "send" },
        keyboard: { support: "native", direction: "send" },
        button: { support: "native", direction: "send" },
    },
    transports: {
        gateway: { support: "native", mode: "websocket" },
        webhook: { support: "native", mode: "webhook" },
        manual: {
            support: "native",
            mode: "native",
            note: "通过 Client.ingest() 或 acceptHttp(Request) 接入既有 Host",
        },
    },
});
