import type { FeishuAPIResponse, FeishuEvent, FeishuWebhookBody } from "./types.js";

export function isFeishuApiEnvelope(value: unknown): value is FeishuAPIResponse {
    return isRecord(value) && typeof value.code === "number" && typeof value.msg === "string";
}

export function isFeishuEvent(value: unknown): value is FeishuEvent & FeishuWebhookBody {
    if (!isRecord(value) || !isRecord(value.header)) return false;
    return typeof value.header.event_type === "string" && typeof value.header.event_id === "string";
}

export function isFeishuWebhookBody(value: unknown): value is FeishuWebhookBody {
    return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
