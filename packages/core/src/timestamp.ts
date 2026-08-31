/**
 * 统一时间戳工具：各平台有的返回 Unix **秒**、有的返回 **毫秒**，CommonEvent 等统一用 **毫秒**。
 */

/** 启发式阈值：大于等于该值视为已是毫秒（约对应 2001-09-09 之后的毫秒时间戳） */
export const UNIX_TIMESTAMP_MS_MIN = 10_000_000_000;

/**
 * 平台明确给出 **Unix 秒**（如微信公众号 CreateTime、飞书 create_time）时，转为事件用的 **毫秒**。
 *
 * @param seconds - 秒级时间戳（number / 数字字符串）
 * @param options.fallbackMs - 空值、非有限数或 ≤0 时使用的毫秒时间，默认 `Date.now()`
 */
export function unixSecondsToEventMs(
    seconds: unknown,
    options?: { fallbackMs?: number },
): number {
    const fallback = options?.fallbackMs ?? Date.now();
    if (seconds == null || seconds === "") return fallback;
    const n = typeof seconds === "string" ? parseFloat(seconds) : Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.floor(n * 1000);
}

/**
 * 平台明确给出 **Unix 毫秒** 时，校验并取整；无效时使用 fallback。
 */
export function unixMillisToEventMs(
    ms: unknown,
    options?: { fallbackMs?: number },
): number {
    const fallback = options?.fallbackMs ?? Date.now();
    if (ms == null || ms === "") return fallback;
    const n = typeof ms === "string" ? parseFloat(ms) : Number(ms);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.floor(n);
}

/**
 * 不确定单位时使用：**大于等于 {@link UNIX_TIMESTAMP_MS_MIN} 视为毫秒**，否则视为秒。
 * 适用于部分文档不清或中间层混传的场景。
 */
export function coerceUnixToEventMs(
    value: unknown,
    options?: { fallbackMs?: number },
): number {
    const fallback = options?.fallbackMs ?? Date.now();
    if (value == null || value === "") return fallback;
    const n = typeof value === "string" ? parseFloat(value) : Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    if (n >= UNIX_TIMESTAMP_MS_MIN) return Math.floor(n);
    return Math.floor(n * 1000);
}

/**
 * 需要 **Unix 秒** 的字段（如部分协议里的 message `time`）时使用。
 *
 * @param seconds - 秒级时间戳
 * @param options.fallbackSec - 无效时的秒级时间，默认当前 `Date.now()/1000` 取整
 */
export function toUnixSeconds(
    seconds: unknown,
    options?: { fallbackSec?: number },
): number {
    const fallback =
        options?.fallbackSec ?? Math.floor(Date.now() / 1000);
    if (seconds == null || seconds === "") return fallback;
    const n = typeof seconds === "string" ? parseFloat(seconds) : Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.floor(n);
}

/**
 * 平台返回 **ISO 8601 字符串**或其它 `Date` 可解析格式（如 QQ 开放消息 `timestamp`）时，转为事件用的 **毫秒**。
 */
export function dateLikeToEventMs(
    value: unknown,
    options?: { fallbackMs?: number },
): number {
    const fallback = options?.fallbackMs ?? Date.now();
    if (value == null || value === "") return fallback;
    const t = new Date(value as string | number).getTime();
    return Number.isFinite(t) ? t : fallback;
}
