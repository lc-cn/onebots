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

/** 从协议入站参数中读取一个非空字符串。 */
export function requireNonEmptyStringParam(
    params: Readonly<Record<string, unknown>>,
    key: string,
): string {
    const value = params[key];
    if (typeof value !== "string" || value.trim() === "") {
        throw new TypeError(`${key} 必须是非空字符串`);
    }
    return value;
}
