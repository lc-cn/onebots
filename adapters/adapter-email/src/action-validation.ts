import { EmailError } from "./errors.js";

export function exactParams(
    params: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
): void {
    const fields = new Set(allowed);
    const unknown = Object.keys(params).find(name => !fields.has(name));
    if (unknown) throw invalid(unknown);
}

export function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw invalid(field);
    return value.trim();
}

export function optionalString(value: unknown, field = "optional_string"): string | undefined {
    return value === undefined ? undefined : requireString(value, field);
}

export function requireBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw invalid(field);
    return value;
}

export function requireInteger(value: unknown, field: string): number {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) throw invalid(field);
    return Number(value);
}

export function optionalInteger(value: unknown, field: string): number | undefined {
    return value === undefined ? undefined : requireInteger(value, field);
}

export function requireIntegers(value: unknown, field: string): number[] {
    const values = Array.isArray(value) ? value : [value];
    if (!values.length) throw invalid(field);
    const result = values.map(item => requireInteger(item, field));
    if (new Set(result).size !== result.length) throw invalid(field);
    return result;
}

export function stringList(value: unknown, field: string): string[] {
    const values = Array.isArray(value) ? value : [value];
    if (!values.length) throw invalid(field);
    return values.map(item => requireString(item, field));
}

export function optionalStringList(value: unknown, field: string): string[] | undefined {
    return value === undefined ? undefined : stringList(value, field);
}

export function flagList(value: unknown, field: string): string[] {
    const flags = stringList(value, field);
    if (flags.some(flag => /[\u0000\r\n]/u.test(flag)) || new Set(flags).size !== flags.length) {
        throw invalid(field);
    }
    return flags;
}

export function optionalFlagList(value: unknown, field: string): string[] | undefined {
    return value === undefined ? undefined : flagList(value, field);
}

export function mailboxPath(value: unknown, field: string): string {
    const path = requireString(value, field);
    if (/[\u0000\r\n]/u.test(path)) throw invalid(field);
    return path;
}

export function optionalMailboxPath(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : mailboxPath(value, field);
}

export function requireDate(value: unknown, field: string): string | Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
    throw invalid(field);
}

export function canonicalBase64(value: unknown, field: string): Buffer {
    const encoded = requireString(value, field);
    if (
        encoded.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
    ) {
        throw invalid(field);
    }
    const content = Buffer.from(encoded, "base64");
    if (content.length === 0 || content.length > 50 * 1024 * 1024) throw invalid(field);
    return content;
}

export function invalid(field: string): EmailError {
    return new EmailError(`邮件动作参数 ${field} 无效`, { code: "EMAIL_INVALID_ACTION_PARAM" });
}
