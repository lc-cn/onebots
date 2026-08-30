import type { AdapterCapabilityManifest } from "onebots";

/** 不依赖平台适配器即可由协议层完成的动作。 */
const PROTOCOL_BUILTIN_ACTIONS = ["get_self_info", "get_supported_actions"] as const;

/**
 * OneBot 12 标准动作到 canonical Adapter 能力的映射。
 *
 * 动作名不同时必须在这里显式投影，避免协议层能力声明与实际调用路径各自维护。
 */
const STANDARD_ACTION_REQUIREMENTS: Readonly<Record<string, string>> = {
    send_message: "send_message",
    delete_message: "delete_message",
    get_user_info: "get_user_info",
    get_friend_list: "get_friend_list",
    get_group_info: "get_group_info",
    get_group_list: "get_group_list",
    get_group_member_info: "get_group_member_info",
    get_group_member_list: "get_group_member_list",
    set_group_name: "set_group_name",
    leave_group: "leave_group",
    invite_friend_to_group: "invite_group_member",
    accept_friend_request: "handle_friend_request",
    handle_friend_request: "handle_friend_request",
    handle_group_request: "handle_group_request",
    get_guild_info: "get_guild_info",
    get_guild_list: "get_guild_list",
    get_guild_member_info: "get_guild_member_info",
    get_guild_member_list: "get_guild_member_list",
    get_channel_info: "get_channel_info",
    get_channel_list: "get_channel_list",
    set_channel_name: "update_channel",
    get_channel_member_info: "get_channel_member_info",
    get_channel_member_list: "get_channel_member_list",
    get_status: "get_status",
    get_version: "get_version",
};

/**
 * 这些动作已被协议分派器保留，但其 OneBot 文件缓存语义尚不能无损映射到
 * 需要目标会话的 Adapter 文件接口。完成独立文件存储模块前不得对外宣称支持。
 */
const RESERVED_FILE_ACTIONS = new Set([
    "upload_file",
    "upload_file_fragmented_prepare",
    "upload_file_fragmented_transfer",
    "upload_file_fragmented_finish",
    "get_file",
    "get_file_fragmented_prepare",
    "get_file_fragmented_transfer",
]);

function isSupported(manifest: AdapterCapabilityManifest, action: string): boolean {
    const descriptor = manifest.actions[action];
    return descriptor !== undefined && descriptor.support !== "unsupported";
}

/**
 * 将适配器的真实能力投影为当前账号可调用的 OneBot 12 动作集合。
 * 平台扩展动作保持原名，使下游既能使用标准协议，也不会丢失平台原生能力。
 */
export function projectOneBotV12Actions(manifest: AdapterCapabilityManifest): string[] {
    const actions = new Set<string>(PROTOCOL_BUILTIN_ACTIONS);

    for (const [protocolAction, adapterAction] of Object.entries(STANDARD_ACTION_REQUIREMENTS)) {
        if (isSupported(manifest, adapterAction)) actions.add(protocolAction);
    }

    for (const [action, descriptor] of Object.entries(manifest.actions)) {
        if (descriptor.support !== "unsupported" && !RESERVED_FILE_ACTIONS.has(action)) {
            actions.add(action);
        }
    }

    return [...actions].sort();
}
