import { createSlackMethodHandlers } from "./platform-action-methods.js";

const CALL_METHODS = {
    create_call: "calls.add",
    get_call: "calls.info",
    update_call: "calls.update",
    end_call: "calls.end",
    add_call_participants: "calls.participants.add",
    remove_call_participants: "calls.participants.remove",
} as const;

/** 将外部通话原生投影到 Slack 的 Call、加入按钮和参与者界面。 */
export const SLACK_CALL_ACTIONS = createSlackMethodHandlers(CALL_METHODS);

export const SLACK_CALL_ACTION_NAMES = new Set(Object.keys(CALL_METHODS));
export const SLACK_CALL_READ_ACTION_NAMES = new Set(["get_call"]);
