import type { SlackBot } from "./bot.js";

export const SLACK_PLATFORM_ACTIONS = new Set([
    "call_slack_api",
    "add_reaction",
    "remove_reaction",
    "add_pin",
    "remove_pin",
    "get_thread_replies",
    "open_conversation",
    "create_channel",
    "archive_channel",
    "unarchive_channel",
    "rename_channel",
    "set_channel_topic",
    "set_channel_purpose",
    "join_channel",
    "invite_channel_members",
    "kick_channel_member",
    "schedule_message",
    "delete_scheduled_message",
    "list_scheduled_messages",
    "add_bookmark",
    "edit_bookmark",
    "remove_bookmark",
    "list_bookmarks",
]);

const METHOD_BY_ACTION: Readonly<Record<string, string>> = {
    add_reaction: "reactions.add",
    remove_reaction: "reactions.remove",
    add_pin: "pins.add",
    remove_pin: "pins.remove",
    get_thread_replies: "conversations.replies",
    open_conversation: "conversations.open",
    create_channel: "conversations.create",
    archive_channel: "conversations.archive",
    unarchive_channel: "conversations.unarchive",
    rename_channel: "conversations.rename",
    set_channel_topic: "conversations.setTopic",
    set_channel_purpose: "conversations.setPurpose",
    join_channel: "conversations.join",
    invite_channel_members: "conversations.invite",
    kick_channel_member: "conversations.kick",
    schedule_message: "chat.scheduleMessage",
    delete_scheduled_message: "chat.deleteScheduledMessage",
    list_scheduled_messages: "chat.scheduledMessages.list",
    add_bookmark: "bookmarks.add",
    edit_bookmark: "bookmarks.edit",
    remove_bookmark: "bookmarks.remove",
    list_bookmarks: "bookmarks.list",
};

/** 执行能力清单允许的 Slack Web API 扩展动作。 */
export async function executeSlackPlatformAction(
    bot: SlackBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    if (action === "call_slack_api") {
        const method = requireMethod(params.method);
        return bot.call(method, requireObject(params.params, "params", {}));
    }
    const method = METHOD_BY_ACTION[action];
    if (!method) throw new Error(`未实现 Slack 平台动作: ${action}`);
    return bot.call(method, { ...params });
}

function requireMethod(value: unknown): string {
    if (typeof value !== "string" || !/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/.test(value)) {
        throw new Error("Slack 参数 method 必须为合法的 Web API 方法名");
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
        throw new Error(`Slack 参数 ${name} 必须为对象`);
    }
    return value as Record<string, unknown>;
}
