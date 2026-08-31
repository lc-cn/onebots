/**
 * 协议公开 API 到 OneBots Adapter 能力的映射。
 *
 * 字符串条目表示协议 API 与 Adapter 能力同名；二元组用于名称不同的投影；
 * null 表示协议层自身即可完成，不依赖平台能力；anyOf 表示任一能力可实现该 API，
 * allOf 表示完整实现该 API 需要全部能力；action + scene 用于区分协议中拆分的私聊/群聊 API。
 */

const oneBotV11 = [
    ["send_private_msg", { action: "send_message", scene: "direct" }],
    ["send_group_msg", { action: "send_message", scene: "group" }],
    ["send_msg", "send_message"],
    ["delete_msg", "delete_message"],
    ["get_msg", "get_message"],
    ["get_forward_msg", "get_forward_message"],
    "send_like",
    ["set_group_kick", "kick_group_member"],
    ["invite_friend_to_group", "invite_group_member"],
    ["set_group_ban", "mute_group_member"],
    ["set_group_anonymous_ban", "mute_group_anonymous"],
    ["set_group_whole_ban", "mute_group_all"],
    "set_group_admin",
    "set_group_anonymous",
    "set_group_card",
    "set_group_name",
    ["set_group_leave", "leave_group"],
    "set_group_special_title",
    ["set_friend_add_request", "handle_friend_request"],
    ["accept_friend_request", "handle_friend_request"],
    ["set_group_add_request", "handle_group_request"],
    ["get_login_info", null],
    ["get_stranger_info", "get_user_info"],
    "get_friend_list",
    "get_group_info",
    "get_group_list",
    "get_group_member_info",
    "get_group_member_list",
    "get_group_honor_info",
    "get_cookies",
    "get_csrf_token",
    "get_credentials",
    "get_record",
    "get_image",
    "can_send_image",
    "can_send_record",
    "get_status",
    ["get_version_info", "get_version"],
    "set_restart",
    "clean_cache",
];

const oneBotV12 = [
    "send_message",
    "delete_message",
    ["get_self_info", null],
    ["get_supported_actions", null],
    "get_status",
    "get_version",
    "get_user_info",
    "get_friend_list",
    "get_group_info",
    "get_group_list",
    "get_group_member_info",
    "get_group_member_list",
    "set_group_name",
    "leave_group",
    ["invite_friend_to_group", "invite_group_member"],
    ["accept_friend_request", "handle_friend_request"],
    "handle_friend_request",
    "handle_group_request",
    "get_guild_info",
    "get_guild_list",
    "get_guild_member_info",
    "get_guild_member_list",
    "get_channel_info",
    "get_channel_list",
    ["set_channel_name", "update_channel"],
    "get_channel_member_info",
    "get_channel_member_list",
];

const satoriV1 = [
    ["message.create", "send_message"],
    ["message.get", "get_message"],
    ["message.delete", "delete_message"],
    ["message.update", "update_message"],
    ["message.list", "get_message_history"],
    ["reaction.create", { anyOf: ["add_message_reaction", "send_group_message_reaction"] }],
    ["reaction.delete", { anyOf: ["remove_message_reaction", "send_group_message_reaction"] }],
    ["channel.get", "get_channel_info"],
    ["channel.list", "get_channel_list"],
    ["channel.create", "create_channel"],
    ["channel.update", "update_channel"],
    ["channel.delete", "delete_channel"],
    ["guild.get", "get_guild_info"],
    ["guild.list", "get_guild_list"],
    ["guild.member.get", "get_guild_member_info"],
    ["guild.member.list", "get_guild_member_list"],
    ["guild.member.kick", "kick_guild_member"],
    ["guild.member.mute", "mute_guild_member"],
    ["user.get", "get_user_info"],
    ["user.channel.create", "create_user_channel"],
    ["friend.list", "get_friend_list"],
    ["friend.delete", "delete_friend"],
    ["friend.approve", "handle_friend_request"],
    ["guild.approve", "handle_group_request"],
    ["guild.member.approve", "handle_group_request"],
    ["login.get", "get_login_info"],
];

const milkyV1 = [
    ["send_private_message", { action: "send_message", scene: "direct" }],
    ["send_group_message", { action: "send_message", scene: "group" }],
    ["recall_private_message", { action: "delete_message", scene: "direct" }],
    ["recall_group_message", { action: "delete_message", scene: "group" }],
    "get_message",
    ["get_history_messages", "get_message_history"],
    "get_resource_temp_url",
    ["get_forwarded_messages", "get_forward_message"],
    "mark_message_as_read",
    "delete_friend",
    "set_avatar",
    "set_nickname",
    "set_bio",
    "get_custom_face_url_list",
    "get_peer_pins",
    "set_peer_pin",
    "kick_group_member",
    ["invite_friend_to_group", "invite_group_member"],
    ["set_group_member_mute", "mute_group_member"],
    ["set_group_member_admin", "set_group_admin"],
    ["set_group_member_card", "set_group_card"],
    ["set_group_member_special_title", "set_group_special_title"],
    "set_group_name",
    ["quit_group", "leave_group"],
    "send_group_nudge",
    "set_group_avatar",
    ["set_group_whole_mute", "mute_group_all"],
    "send_group_announcement",
    [
        "set_group_essence_message",
        { allOf: ["set_group_essence_message", "delete_group_essence_message"] },
    ],
    "send_group_message_reaction",
    "get_group_announcements",
    "delete_group_announcement",
    "get_group_essence_messages",
    ["accept_group_request", "handle_group_request"],
    ["reject_group_request", "handle_group_request"],
    ["accept_group_invitation", "handle_group_request"],
    ["reject_group_invitation", "handle_group_request"],
    ["accept_friend_request", "handle_friend_request"],
    ["reject_friend_request", "handle_friend_request"],
    ["upload_private_file", { action: "upload_file", scene: "direct" }],
    ["upload_group_file", { action: "upload_file", scene: "group" }],
    ["get_private_file_download_url", { action: "get_file_download_url", scene: "direct" }],
    ["get_group_file_download_url", { action: "get_file_download_url", scene: "group" }],
    "get_group_files",
    "move_group_file",
    "rename_group_file",
    ["delete_group_file", "delete_file"],
    "persist_group_file",
    "create_group_folder",
    "rename_group_folder",
    "delete_group_folder",
    "get_login_info",
    ["get_impl_info", "get_version"],
    "get_status",
    ["get_user_profile", "get_user_info"],
    "get_friend_info",
    "get_friend_list",
    "get_group_info",
    "get_group_list",
    "get_group_member_info",
    "get_group_member_list",
    "get_cookies",
    "get_csrf_token",
    "send_friend_nudge",
    ["send_profile_like", "send_like"],
    "get_friend_requests",
    "get_group_notifications",
];

function normalize(entries) {
    return entries.map(entry => {
        if (typeof entry === "string") return { api: entry, requirement: entry };
        return { api: entry[0], requirement: entry[1] };
    });
}

export const PROTOCOL_API_CAPABILITY_MAP = [
    { key: "onebot-v11", title: "OneBot v11", apis: normalize(oneBotV11) },
    { key: "onebot-v12", title: "OneBot v12", apis: normalize(oneBotV12) },
    { key: "satori-v1", title: "Satori v1", apis: normalize(satoriV1) },
    { key: "milky-v1", title: "Milky v1", apis: normalize(milkyV1) },
];

export function resolveCapabilityStatus(manifest, requirement) {
    if (requirement === null) return "builtin";
    if (typeof requirement === "string") return descriptorStatus(manifest, requirement);
    if (requirement.action) {
        return descriptorStatus(manifest, requirement.action, requirement.scene);
    }
    const actions = requirement.anyOf ?? requirement.allOf;
    const statuses = actions.map(action => descriptorStatus(manifest, action));
    if (requirement.allOf) {
        if (statuses.includes("unsupported")) return "unsupported";
        if (statuses.includes("emulated")) return "emulated";
        return "native";
    }
    if (statuses.includes("native")) return "native";
    if (statuses.includes("emulated")) return "emulated";
    return "unsupported";
}

function descriptorStatus(manifest, action, scene) {
    const descriptor = manifest.actions[action];
    if (!descriptor || descriptor.support === "unsupported") return "unsupported";
    if (scene && descriptor.scenes?.length && !descriptor.scenes.includes(scene)) {
        return "unsupported";
    }
    return descriptor.support;
}
