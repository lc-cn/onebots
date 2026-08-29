import { createHmac, timingSafeEqual } from "node:crypto";
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

/** 解析 Slack Events JSON 或 Slash Command / Interactivity 表单原始体。 */
export function parseSlackHttpBody(rawBody: string | Buffer, contentType = ""): unknown {
    const text = rawBody.toString();
    if (contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
        return Object.fromEntries(new URLSearchParams(text));
    }
    try {
        return JSON.parse(text) as unknown;
    } catch (error) {
        throw SlackError.protocol("Slack Webhook 请求体不是有效 JSON", "SLACK_WEBHOOK_INVALID", {
            cause: error instanceof Error ? error.message : String(error),
        });
    }
}

/** 验证 Slack v0 HMAC，并拒绝超过五分钟的重放请求。 */
export function verifySlackSignature(
    secret: string,
    rawBody: string | Buffer,
    timestamp: string,
    signature: string,
): boolean {
    if (!timestamp || !signature) return false;
    const timestampSeconds = Number(timestamp);
    if (
        !Number.isFinite(timestampSeconds) ||
        Math.abs(Date.now() / 1000 - timestampSeconds) > 300
    ) {
        return false;
    }
    const hmac = createHmac("sha256", secret);
    hmac.update(`v0:${timestamp}:`);
    hmac.update(rawBody);
    const actual = Buffer.from(signature);
    const expected = Buffer.from(`v0=${hmac.digest("hex")}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
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
