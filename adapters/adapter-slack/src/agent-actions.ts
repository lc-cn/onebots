import type { PlatformActionHandler } from "onebots";
import type { SlackBot } from "./bot.js";
import { SlackError } from "./errors.js";

const AGENT_SESSION_STATUSES = new Set(["active", "processing", "suspended", "closed"]);

/** Slack Agent Sessions 的新标准入口；不暴露已进入迁移期的 assistant.threads 兼容 API。 */
export const SLACK_AGENT_ACTIONS: Readonly<Record<string, PlatformActionHandler<SlackBot>>> = {
    set_agent_session_status: (bot, params) =>
        bot.call("agents.sessions.setStatus", {
            channel_id: requiredString(params.channel_id, "channel_id"),
            status: agentStatus(params.status),
            ...optionalString(params, "thread_ts"),
            ...optionalBoundedString(params, "title", 200),
            ...optionalString(params, "initiator_user_id"),
            ...optionalNullableString(params, "icon_emoji"),
            ...optionalNullableString(params, "icon_url"),
            ...optionalNullableString(params, "username", 200),
        }),
    rename_agent_session: (bot, params) =>
        bot.call("agents.sessions.rename", {
            channel_id: requiredString(params.channel_id, "channel_id"),
            title: requiredString(params.title, "title", 200),
            ...optionalString(params, "thread_ts"),
        }),
};

function agentStatus(value: unknown): string {
    const status = requiredString(value, "status");
    if (!AGENT_SESSION_STATUSES.has(status)) {
        throw SlackError.invalid(
            "Slack Agent Session status 必须是 active、processing、suspended 或 closed",
            "SLACK_AGENT_STATUS_INVALID",
        );
    }
    return status;
}

function requiredString(value: unknown, name: string, maxLength?: number): string {
    if (typeof value !== "string" || !value.trim() || (maxLength && value.length > maxLength)) {
        throw SlackError.invalid(
            `Slack Agent Session 参数 ${name} 无效`,
            "SLACK_AGENT_PARAM_INVALID",
            { name, max_length: maxLength },
        );
    }
    return value;
}

function optionalString(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, string> {
    return params[name] === undefined ? {} : { [name]: requiredString(params[name], name) };
}

function optionalBoundedString(
    params: Readonly<Record<string, unknown>>,
    name: string,
    maxLength: number,
): Record<string, string> {
    return params[name] === undefined
        ? {}
        : { [name]: requiredString(params[name], name, maxLength) };
}

function optionalNullableString(
    params: Readonly<Record<string, unknown>>,
    name: string,
    maxLength?: number,
): Record<string, string | null> {
    const value = params[name];
    if (value === undefined) return {};
    return { [name]: value === null ? null : requiredString(value, name, maxLength) };
}
