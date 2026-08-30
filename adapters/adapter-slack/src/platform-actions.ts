import { definePlatformActions } from "onebots";
import { SLACK_AGENT_ACTIONS } from "./agent-actions.js";
import type { SlackBot } from "./bot.js";
import { SlackError } from "./errors.js";
import { createSlackMethodHandlers, withoutSlackToken } from "./platform-action-methods.js";
import { SLACK_CALL_ACTIONS } from "./platform-actions-calls.js";
import { SLACK_COLLABORATION_ACTIONS } from "./platform-actions-collaboration.js";
import { SLACK_LIST_ACTIONS } from "./platform-actions-lists.js";
import { SLACK_REMOTE_FILE_ACTIONS } from "./platform-actions-remote-files.js";

const METHOD_BY_ACTION = {
    add_reaction: "reactions.add",
    remove_reaction: "reactions.remove",
    add_pin: "pins.add",
    remove_pin: "pins.remove",
    get_thread_replies: "conversations.replies",
    open_conversation: "conversations.open",
    archive_channel: "conversations.archive",
    unarchive_channel: "conversations.unarchive",
    rename_channel: "conversations.rename",
    set_channel_topic: "conversations.setTopic",
    set_channel_purpose: "conversations.setPurpose",
    join_channel: "conversations.join",
    invite_channel_members: "conversations.invite",
    leave_channel: "conversations.leave",
    schedule_message: "chat.scheduleMessage",
    delete_scheduled_message: "chat.deleteScheduledMessage",
    list_scheduled_messages: "chat.scheduledMessages.list",
    add_bookmark: "bookmarks.add",
    edit_bookmark: "bookmarks.edit",
    remove_bookmark: "bookmarks.remove",
    list_bookmarks: "bookmarks.list",
} as const;

const METHOD_HANDLERS = createSlackMethodHandlers(METHOD_BY_ACTION);

const PLATFORM_ACTIONS = definePlatformActions(
    {
        call_slack_api: (bot: SlackBot, params: Readonly<Record<string, unknown>>) =>
            bot.call(
                requireMethod(params.method),
                withoutSlackToken(requireObject(params.params, "params", {})),
            ),
        ...METHOD_HANDLERS,
        ...SLACK_COLLABORATION_ACTIONS,
        ...SLACK_AGENT_ACTIONS,
        ...SLACK_LIST_ACTIONS,
        ...SLACK_CALL_ACTIONS,
        ...SLACK_REMOTE_FILE_ACTIONS,
    },
    action => SlackError.invalid(`未实现 Slack 平台动作: ${action}`, "SLACK_ACTION_UNSUPPORTED"),
);

export const SLACK_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type SlackPlatformAction =
    typeof SLACK_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 执行能力清单允许的 Slack Web API 扩展动作。 */
export async function executeSlackPlatformAction(
    bot: SlackBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(bot, action, params);
}

function requireMethod(value: unknown): string {
    if (typeof value !== "string" || !/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/.test(value)) {
        throw SlackError.invalid(
            "Slack 参数 method 必须为合法的 Web API 方法名",
            "SLACK_METHOD_INVALID",
        );
    }
    return value;
}

function requireObject(
    value: unknown,
    name: string,
    fallback?: Record<string, unknown>,
): Record<string, unknown> {
    if (value == null && fallback) return fallback;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw SlackError.invalid(`Slack 参数 ${name} 必须为对象`, "SLACK_PARAM_INVALID", {
            name,
        });
    }
    return value as Record<string, unknown>;
}
