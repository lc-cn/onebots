/** 从协议入站参数中读取一个正安全整数。 */
export function requirePositiveIntegerParam(
    params: Readonly<Record<string, unknown>>,
    key: string,
): number {
    const value = params[key];
    const numeric = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof numeric !== "number" || !Number.isSafeInteger(numeric) || numeric <= 0) {
        throw new TypeError(`${key} 必须是正整数`);
    }
    return numeric;
}
