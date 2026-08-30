import { createHash } from "node:crypto";
import type { SlackWebhookBody } from "./types.js";

/**
 * 返回 Slack 一次投递的稳定身份。
 *
 * Slack 不同入口分别提供 event_id、envelope_id 或 trigger_id；仅在平台没有提供
 * 身份字段时才对完整载荷取摘要。去重与 canonical 事件必须共用这个函数，避免同一
 * 事件在两条链路中获得不同 ID。
 */
export function slackEventIdentity(body: SlackWebhookBody): string {
    const nativeId = [body.event_id, body.envelope_id, body.trigger_id].find(
        value => typeof value === "string" && value,
    );
    if (nativeId) return nativeId;
    return `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`;
}
