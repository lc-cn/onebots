import type {
    ChatAppendStreamArguments,
    ChatStartStreamArguments,
    ChatStopStreamArguments,
} from "@slack/web-api";
import type { PlatformActionHandler } from "onebots";
import { requireSlackAgentSessionStatus, type SlackAgentSessionStatus } from "./agent-actions.js";
import type { SlackBot } from "./bot.js";
import { SlackError } from "./errors.js";
import {
    isSlackRecord,
    optionalSlackString,
    requiredSlackRecord,
    requiredSlackString,
    type SlackActionParams,
} from "./platform-action-input.js";

export type SlackTaskDisplayMode = "timeline" | "plan";

export type SlackStartMessageStreamParams = Omit<
    ChatStartStreamArguments,
    "token" | "thread_ts" | "task_display_mode"
> & {
    thread_ts?: string;
    task_display_mode?: SlackTaskDisplayMode;
};

export type SlackAppendMessageStreamParams = Omit<ChatAppendStreamArguments, "token">;

export type SlackStopMessageStreamParams = Omit<
    ChatStopStreamArguments,
    "token" | "session_status"
> & {
    session_status?: SlackAgentSessionStatus;
};

const TASK_DISPLAY_MODES = new Set<SlackTaskDisplayMode>(["timeline", "plan"]);

/** Slack Streaming API 的闭合动作；凭据始终来自当前 Bot，不接受 token 覆盖。 */
export const SLACK_STREAM_ACTIONS: Readonly<Record<string, PlatformActionHandler<SlackBot>>> = {
    start_message_stream: (bot, params) => bot.call("chat.startStream", startStreamParams(params)),
    append_message_stream: (bot, params) =>
        bot.call("chat.appendStream", appendStreamParams(params)),
    stop_message_stream: (bot, params) => bot.call("chat.stopStream", stopStreamParams(params)),
};

function startStreamParams(params: SlackActionParams): Record<string, unknown> {
    validateStreamContent(params, false);
    return {
        channel: requiredSlackString(params.channel, "channel"),
        ...optionalSlackString(params, "thread_ts"),
        ...optionalSlackString(params, "recipient_team_id"),
        ...optionalSlackString(params, "recipient_user_id"),
        ...optionalSlackString(params, "markdown_text", 12_000),
        ...optionalChunks(params),
        ...optionalTaskDisplayMode(params.task_display_mode),
        ...optionalSlackString(params, "icon_emoji"),
        ...optionalHttpUrl(params.icon_url, "icon_url"),
        ...optionalSlackString(params, "username", 200),
    };
}

function appendStreamParams(params: SlackActionParams): Record<string, unknown> {
    validateStreamContent(params, true);
    return {
        channel: requiredSlackString(params.channel, "channel"),
        ts: requiredSlackString(params.ts, "ts"),
        ...optionalSlackString(params, "markdown_text", 12_000),
        ...optionalChunks(params),
    };
}

function stopStreamParams(params: SlackActionParams): Record<string, unknown> {
    validateStreamContent(params, false);
    return {
        channel: requiredSlackString(params.channel, "channel"),
        ts: requiredSlackString(params.ts, "ts"),
        ...optionalSlackString(params, "markdown_text", 12_000),
        ...optionalChunks(params),
        ...optionalRecord(params, "metadata"),
        ...optionalRecordArray(params, "blocks", 50),
        ...optionalAgentSessionStatus(params.session_status),
    };
}

function validateStreamContent(params: SlackActionParams, required: boolean): void {
    const hasMarkdown = params.markdown_text !== undefined;
    const hasChunks = params.chunks !== undefined;
    if (hasMarkdown && hasChunks) {
        throw SlackError.invalid(
            "Slack 流式消息不能同时提供 markdown_text 与 chunks",
            "SLACK_STREAM_CONTENT_CONFLICT",
        );
    }
    if (required && !hasMarkdown && !hasChunks) {
        throw SlackError.invalid(
            "Slack 追加流式消息必须提供 markdown_text 或 chunks",
            "SLACK_STREAM_CONTENT_REQUIRED",
        );
    }
}

function optionalChunks(params: SlackActionParams): Record<string, unknown[]> {
    if (params.chunks === undefined) return {};
    return { chunks: recordArray(params.chunks, "chunks") };
}

function optionalRecordArray(
    params: SlackActionParams,
    name: string,
    maxLength?: number,
): Record<string, unknown[]> {
    if (params[name] === undefined) return {};
    return { [name]: recordArray(params[name], name, maxLength) };
}

function recordArray(value: unknown, name: string, maxLength?: number): Record<string, unknown>[] {
    if (
        !Array.isArray(value) ||
        value.length === 0 ||
        (maxLength !== undefined && value.length > maxLength) ||
        !value.every(isSlackRecord)
    ) {
        throw SlackError.invalid(`Slack 参数 ${name} 必须为非空对象数组`, "SLACK_PARAM_INVALID", {
            name,
            max_length: maxLength,
        });
    }
    return value;
}

function optionalRecord(
    params: SlackActionParams,
    name: string,
): Record<string, Record<string, unknown>> {
    return params[name] === undefined ? {} : { [name]: requiredSlackRecord(params[name], name) };
}

function optionalTaskDisplayMode(value: unknown): { task_display_mode?: SlackTaskDisplayMode } {
    if (value === undefined) return {};
    if (typeof value !== "string" || !TASK_DISPLAY_MODES.has(value as SlackTaskDisplayMode)) {
        throw SlackError.invalid(
            "Slack task_display_mode 必须是 timeline 或 plan",
            "SLACK_TASK_DISPLAY_MODE_INVALID",
        );
    }
    return { task_display_mode: value as SlackTaskDisplayMode };
}

function optionalAgentSessionStatus(value: unknown): { session_status?: SlackAgentSessionStatus } {
    if (value === undefined) return {};
    return { session_status: requireSlackAgentSessionStatus(value) };
}

function optionalHttpUrl(value: unknown, name: string): Record<string, string> {
    if (value === undefined) return {};
    const url = requiredSlackString(value, name);
    const parsed = URL.parse(url);
    if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
        throw SlackError.invalid(`Slack 参数 ${name} 必须为 HTTP(S) URL`, "SLACK_PARAM_INVALID", {
            name,
        });
    }
    return { [name]: url };
}
