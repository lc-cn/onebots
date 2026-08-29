import { SlackError } from "./errors.js";
import type { SlackEvent, SlackWebhookBody } from "./types.js";

/** 解析 Events API、Slash Command 与交互组件的统一入站载荷。 */
export function parseSlackInbound(value: unknown): SlackWebhookBody {
    const input = objectValue(value);
    const payload = input.payload;
    if (typeof payload === "string") {
        try {
            return requireSlackBody(JSON.parse(payload));
        } catch (error) {
            if (error instanceof SlackError) throw error;
            throw SlackError.protocol("Slack 交互 payload 不是有效 JSON", "SLACK_PAYLOAD_INVALID", {
                cause: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return requireSlackBody(input);
}

function requireSlackBody(value: unknown): SlackWebhookBody {
    const body = objectValue(value);
    if (!Object.keys(body).length) {
        throw SlackError.protocol("Slack 入站事件必须是非空对象", "SLACK_EVENT_INVALID");
    }
    if (body.event !== undefined && !isSlackEvent(body.event)) {
        throw SlackError.protocol("Slack Events API 的 event 字段无效", "SLACK_EVENT_INVALID");
    }
    if (
        typeof body.type !== "string" &&
        typeof body.command !== "string" &&
        body.event === undefined
    ) {
        throw SlackError.protocol(
            "Slack 入站事件缺少 type、command 或 event",
            "SLACK_EVENT_INVALID",
        );
    }
    return body as SlackWebhookBody;
}

function isSlackEvent(value: unknown): value is SlackEvent {
    const event = objectValue(value);
    return typeof event.type === "string" && event.type.length > 0;
}

function objectValue(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}
