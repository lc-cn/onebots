/** 异常历史时间只影响该条时间标签，不应中断整段聊天的渲染。 */
export function formatAccountMessageTime(
    value: number,
    formatter: Intl.DateTimeFormat,
): { datetime?: string; label: string } {
    if (typeof value !== "number" || !Number.isFinite(value)) return { label: "时间未知" };
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return { label: "时间未知" };
    return { datetime: date.toISOString(), label: formatter.format(date) };
}
