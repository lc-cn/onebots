import type { ManagementEvidenceIdentity } from "./management-evidence-identity.js";
import { parseManagementStreamIdentity } from "./management-stream-identity.js";

export function parseLogStreamIdentity(payload: unknown): ManagementEvidenceIdentity | null {
    return parseManagementStreamIdentity(payload, "日志事件流");
}

export function parseLogStreamMessage(payload: unknown): string {
    if (!isRecord(payload) || typeof payload.message !== "string") {
        throw new Error("日志事件流包含无效消息");
    }
    return payload.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
