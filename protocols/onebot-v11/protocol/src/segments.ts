import type { CommonTypes } from "onebots";

// ============================================
// 出站消息段 → OneBot V11 消息段
// ============================================

/** 将原始平台 ID 归一化为通用 ID（由协议所在适配器提供） */
export type CreateId = (raw: string | number) => CommonTypes.Id;

export interface V11Segment {
    type: string;
    data: unknown;
}

function isCommonId(value: unknown): value is CommonTypes.Id {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.number === "number" && typeof candidate.string === "string";
}

/**
 * 计算 V11 at 段的 `qq` 字段。
 * OneBot V11 规定 at 段必须带 `qq`（数字 ID 字符串或 `all`），
 * 而各适配器通常只给出 `user_id` / `id`，因此在协议层统一补齐。
 */
function toV11AtTarget(value: unknown, createId: CreateId): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === "all") return "all";
    if (isCommonId(value)) return String(value.number);
    if (typeof value === "number" || typeof value === "string") {
        return String(createId(value).number);
    }
    return undefined;
}

/** 已带 `qq` 的段保持原值，仅把通用 ID 对象折叠为数字字符串 */
function existingQq(value: unknown): string | undefined {
    if (isCommonId(value)) return String(value.number);
    if (typeof value === "number") return String(value);
    if (typeof value === "string" && value) return value;
    return undefined;
}

function convertAtSegment(segment: CommonTypes.Segment, createId: CreateId): V11Segment {
    const data = (segment.data ?? {}) as Record<string, unknown>;
    const scope = data.scope === "all" || data.type === "all" ? "all" : undefined;
    const qq =
        existingQq(data.qq) ??
        toV11AtTarget(data.user_id, createId) ??
        toV11AtTarget(data.id, createId) ??
        scope;
    if (qq === undefined) return { type: segment.type, data: segment.data };
    return { type: "at", data: { ...data, qq } };
}

/** 将通用消息段转换为 OneBot V11 消息段 */
export function convertSegmentsToV11(
    segments: CommonTypes.Segment[],
    createId: CreateId,
): V11Segment[] {
    return segments.map(segment =>
        segment.type === "at"
            ? convertAtSegment(segment, createId)
            : { type: segment.type, data: segment.data },
    );
}
