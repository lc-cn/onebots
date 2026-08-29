import { MILKY_ACCOUNT_ACTIONS } from "./account-actions.js";
import { MILKY_FRIEND_REQUEST_ACTIONS } from "./friend-requests.js";
import { MILKY_GROUP_ACTIONS } from "./group-actions.js";
import { MILKY_GROUP_REQUEST_ACTIONS } from "./group-requests.js";

const DIRECT_ACTIONS = [
    "send_private_message",
    "send_group_message",
    "recall_private_message",
    "recall_group_message",
    "get_message",
    "get_history_messages",
    "get_resource_temp_url",
    "mark_message_as_read",
    "get_forwarded_messages",
    "get_login_info",
    "get_impl_info",
    "get_status",
    "get_user_profile",
    "get_friend_info",
    "get_friend_list",
    "get_cookies",
    "get_csrf_token",
    "send_friend_nudge",
    "send_profile_like",
    "get_friend_requests",
    "get_group_info",
    "get_group_list",
    "get_group_member_info",
    "get_group_member_list",
    "get_group_notifications",
    "get_group_files",
    "create_group_folder",
    "upload_private_file",
    "upload_group_file",
    "get_private_file_download_url",
    "get_group_file_download_url",
    "move_group_file",
    "rename_group_file",
    "delete_group_file",
    "persist_group_file",
    "rename_group_folder",
    "delete_group_folder",
] as const;

/** Milky 标准动作与 OneBots 明确扩展的唯一路由源。 */
export const MILKY_ACTIONS = new Set<string>([
    ...DIRECT_ACTIONS,
    ...MILKY_ACCOUNT_ACTIONS,
    ...MILKY_GROUP_ACTIONS,
    ...MILKY_GROUP_REQUEST_ACTIONS,
    ...MILKY_FRIEND_REQUEST_ACTIONS,
]);

export function isMilkyAction(action: string): boolean {
    return MILKY_ACTIONS.has(action);
}
