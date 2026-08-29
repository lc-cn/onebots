import { MILKY_ACCOUNT_ACTIONS } from "./account-actions.js";
import { MILKY_FRIEND_REQUEST_ACTIONS } from "./friend-requests.js";
import { MILKY_GROUP_ACTIONS } from "./group-actions.js";
import { MILKY_GROUP_REQUEST_ACTIONS } from "./group-requests.js";
import { MILKY_FILE_ACTIONS } from "./file-actions.js";
import { MILKY_MESSAGE_ACTIONS } from "./message-actions.js";
import { MILKY_DIRECTORY_ACTIONS } from "./directory-actions.js";

const DIRECT_ACTIONS = ["get_friend_requests", "get_group_notifications"] as const;

/** Milky 标准动作与 OneBots 明确扩展的唯一路由源。 */
export const MILKY_ACTIONS = new Set<string>([
    ...DIRECT_ACTIONS,
    ...MILKY_ACCOUNT_ACTIONS,
    ...MILKY_GROUP_ACTIONS,
    ...MILKY_GROUP_REQUEST_ACTIONS,
    ...MILKY_FRIEND_REQUEST_ACTIONS,
    ...MILKY_FILE_ACTIONS,
    ...MILKY_MESSAGE_ACTIONS,
    ...MILKY_DIRECTORY_ACTIONS,
]);

export function isMilkyAction(action: string): boolean {
    return MILKY_ACTIONS.has(action);
}
