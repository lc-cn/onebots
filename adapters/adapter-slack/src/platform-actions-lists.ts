import { createSlackMethodHandlers } from "./platform-action-methods.js";

/** Slack Lists 的列表、记录、访问控制与异步下载动作。 */
export const SLACK_LIST_ACTIONS = createSlackMethodHandlers({
    create_list: "slackLists.create",
    update_list: "slackLists.update",
    set_list_access: "slackLists.access.set",
    delete_list_access: "slackLists.access.delete",
    start_list_download: "slackLists.download.start",
    get_list_download: "slackLists.download.get",
    create_list_item: "slackLists.items.create",
    update_list_item: "slackLists.items.update",
    delete_list_item: "slackLists.items.delete",
    delete_list_items: "slackLists.items.deleteMultiple",
    get_list_item: "slackLists.items.info",
    get_list_items: "slackLists.items.list",
});

export const SLACK_LIST_ACTION_NAMES: ReadonlySet<string> = new Set(
    Object.keys(SLACK_LIST_ACTIONS),
);

export const SLACK_LIST_READ_ACTION_NAMES: ReadonlySet<string> = new Set([
    "start_list_download",
    "get_list_download",
    "get_list_item",
    "get_list_items",
]);
