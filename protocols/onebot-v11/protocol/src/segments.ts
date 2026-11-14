import type { CommonTypes } from "onebots";

// ============================================
// 出站消息段 → OneBot V11 消息段
// ============================================

/** 将原始平台 ID 归一化为通用 ID（由协议所在适配器提供） */
export type CreateId = (raw: string | number) => CommonTypes.Id;

export interface SegmentIdContext {
    /** 将原始平台 ID 归一化为通用 ID */
    createId: CreateId;
    /** 当前机器人账号的通用 ID（适配器用 `self` 标记 @机器人 时使用） */
    selfId: () => CommonTypes.Id;
    /** ID 映射失败时的错误上报（该段会降级为文本，不中断整条消息） */
    onError: (error: unknown) => void;
}

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
function toV11AtTarget(value: unknown, context: SegmentIdContext): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === "all") return "all";
    if (value === "self") return String(context.selfId().number);
    if (isCommonId(value)) return String(value.number);
    if (typeof value === "number" || typeof value === "string") {
        return String(context.createId(value).number);
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

function resolveAtTarget(
    data: Record<string, unknown>,
    context: SegmentIdContext,
): string | undefined {
    if (data.scope === "all" || data.type === "all") return "all";
    return (
        existingQq(data.qq) ??
        toV11AtTarget(data.user_id, context) ??
        toV11AtTarget(data.id, context)
    );
}

function idLabel(value: unknown): string | undefined {
    if (isCommonId(value)) return value.string;
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
    return undefined;
}

/** 无法给出合法 `qq` 的 at 段（如仅有 role_id）退化为可见文本，避免产出非法 V11 段 */
function atAsText(data: Record<string, unknown>): V11Segment {
    const label =
        idLabel(data.name) ??
        idLabel(data.text) ??
        idLabel(data.role_id) ??
        idLabel(data.user_id) ??
        idLabel(data.id) ??
        "";
    return { type: "text", data: { text: `@${label.replace(/^@/u, "")}` } };
}

function convertAtSegment(segment: CommonTypes.Segment, context: SegmentIdContext): V11Segment {
    const data = (segment.data ?? {}) as Record<string, unknown>;
    let qq: string | undefined;
    try {
        qq = resolveAtTarget(data, context);
    } catch (error) {
        context.onError(error);
    }
    if (qq === undefined) return atAsText(data);
    return { type: "at", data: { ...data, qq } };
}

/** 将通用消息段转换为 OneBot V11 消息段 */
export function convertSegmentsToV11(
    segments: CommonTypes.Segment[],
    context: SegmentIdContext,
): V11Segment[] {
    return segments.map(segment =>
        segment.type === "at"
            ? convertAtSegment(segment, context)
            : { type: segment.type, data: segment.data },
    );
}
