import { createSlackMethodHandlers } from "./platform-action-methods.js";

const REMOTE_FILE_METHODS = {
    add_remote_file: "files.remote.add",
    get_remote_file: "files.remote.info",
    list_remote_files: "files.remote.list",
    update_remote_file: "files.remote.update",
    remove_remote_file: "files.remote.remove",
    share_remote_file: "files.remote.share",
} as const;

/** Slack 远程文件索引、预览与频道分享能力。 */
export const SLACK_REMOTE_FILE_ACTIONS = createSlackMethodHandlers(REMOTE_FILE_METHODS);

export const SLACK_REMOTE_FILE_ACTION_NAMES = new Set(Object.keys(REMOTE_FILE_METHODS));
export const SLACK_REMOTE_FILE_READ_ACTION_NAMES = new Set([
    "get_remote_file",
    "list_remote_files",
]);
export const SLACK_REMOTE_FILE_SHARE_ACTION_NAMES = new Set(["share_remote_file"]);
