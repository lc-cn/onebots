import { invalidICQQParam } from "./errors.js";

export type ICQQPlatformActionParams = Readonly<Record<string, unknown>>;

/** ICQQ 平台动作统一参数边界。 */
export function requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) {
        throw invalidICQQParam(`${field} 必须是非空字符串`, value);
    }
    return value;
}

export function optionalString(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw invalidICQQParam("参数必须是字符串", value);
    return value;
}

export function requiredInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw invalidICQQParam(`${field} 必须是安全整数`, value);
    }
    return value;
}

export function requiredQQNumber(value: unknown, field: string): number {
    if (typeof value === "string" && /^\d+$/u.test(value)) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed)) return parsed;
    }
    return requiredInteger(value, field);
}

export function optionalInteger(value: unknown): number | undefined {
    return value === undefined ? undefined : requiredInteger(value, "参数");
}

export function optionalQQNumber(value: unknown): number | undefined {
    return value === undefined ? undefined : requiredQQNumber(value, "group_id");
}

export function optionalBoolean(value: unknown): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") throw invalidICQQParam("参数必须是布尔值", value);
    return value;
}

export function stringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) throw invalidICQQParam(`${field} 必须是字符串数组`, value);
    return value.map(item => requiredString(item, field));
}

export function qqNumberArray(value: unknown, field: string): number[] {
    if (!Array.isArray(value)) throw invalidICQQParam(`${field} 必须是整数数组`, value);
    return value.map(item => requiredQQNumber(item, field));
}

export function stringOrStrings(value: unknown, field: string): string | string[] {
    return Array.isArray(value) ? stringArray(value, field) : requiredString(value, field);
}

export function stringOrInteger(value: unknown, field: string): string | number {
    return typeof value === "string" ? requiredString(value, field) : requiredInteger(value, field);
}

export function record(value: unknown, field: string): ICQQPlatformActionParams {
    if (!isRecord(value)) throw invalidICQQParam(`${field} 必须是对象`, value);
    return value;
}

export function isRecord(value: unknown): value is ICQQPlatformActionParams {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
