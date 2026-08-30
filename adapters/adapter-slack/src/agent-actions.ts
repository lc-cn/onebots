import type { PlatformActionHandler } from "onebots";
import type { SlackBot } from "./bot.js";
import { SlackError } from "./errors.js";
import {
    optionalSlackNullableString,
    optionalSlackString,
    requiredSlackString,
} from "./platform-action-input.js";

export type SlackAgentSessionStatus = "active" | "processing" | "suspended" | "closed";

const AGENT_SESSION_STATUSES = new Set<SlackAgentSessionStatus>([
    "active",
    "processing",
    "suspended",
    "closed",
]);

/** Slack Agent Sessions 的新标准入口；不暴露已进入迁移期的 assistant.threads 兼容 API。 */
export const SLACK_AGENT_ACTIONS: Readonly<Record<string, PlatformActionHandler<SlackBot>>> = {
    set_agent_session_status: (bot, params) =>
        bot.call("agents.sessions.setStatus", {
            channel_id: requiredSlackString(params.channel_id, "channel_id"),
            status: requireSlackAgentSessionStatus(params.status),
            ...optionalSlackString(params, "thread_ts"),
            ...optionalSlackString(params, "title", 200),
            ...optionalSlackString(params, "initiator_user_id"),
            ...optionalSlackNullableString(params, "icon_emoji"),
            ...optionalSlackNullableString(params, "icon_url"),
            ...optionalSlackNullableString(params, "username", 200),
        }),
    rename_agent_session: (bot, params) =>
        bot.call("agents.sessions.rename", {
            channel_id: requiredSlackString(params.channel_id, "channel_id"),
            title: requiredSlackString(params.title, "title", 200),
            ...optionalSlackString(params, "thread_ts"),
        }),
};

export function requireSlackAgentSessionStatus(value: unknown): SlackAgentSessionStatus {
    const status = requiredSlackString(value, "status");
    if (!AGENT_SESSION_STATUSES.has(status as SlackAgentSessionStatus)) {
        throw SlackError.invalid(
            "Slack Agent Session status 必须是 active、processing、suspended 或 closed",
            "SLACK_AGENT_STATUS_INVALID",
        );
    }
    return status as SlackAgentSessionStatus;
}
