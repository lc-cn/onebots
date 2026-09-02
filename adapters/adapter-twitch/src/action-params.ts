import { TwitchError } from "./errors.js";
import type { TwitchHttpMethod } from "./types.js";
import { isRecord } from "./validation.js";

export type TwitchParams = Readonly<Record<string, unknown>>;

export function requireString(value: unknown, field: string, max = 1000): string {
    if (typeof value !== "string" || !value.trim() || value.length > max) {
        throw TwitchError.invalid(`${field} 必须是 1 到 ${max} 个字符`);
    }
    return value;
}

export function optionalString(value: unknown, field: string, max = 1000): string | undefined {
    return value === undefined ? undefined : requireString(value, field, max);
}

export function requireId(value: unknown, field: string): string {
    const text = requireString(value, field, 64);
    if (!/^\d+$/u.test(text)) throw TwitchError.invalid(`${field} 必须是 Twitch 数字 ID`);
    return text;
}

export function optionalId(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : requireId(value, field);
}

export function requireObject(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw TwitchError.invalid(`${field} 必须是对象`);
    return structuredClone(value);
}

export function optionalObject(value: unknown, field: string): Record<string, unknown> | undefined {
    return value === undefined ? undefined : requireObject(value, field);
}

export function requireStringArray(value: unknown, field: string, max = 100): string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) {
        throw TwitchError.invalid(`${field} 必须是非空字符串数组`);
    }
    const result = [...new Set(value as string[])];
    if (!result.length || result.length > max)
        throw TwitchError.invalid(`${field} 必须包含 1 到 ${max} 项`);
    return result;
}

export function optionalInteger(
    value: unknown,
    field: string,
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER,
): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
        throw TwitchError.invalid(`${field} 必须是 ${min} 到 ${max} 的整数`);
    }
    return value as number;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") throw TwitchError.invalid(`${field} 必须是布尔值`);
    return value;
}

export function requireMethod(value: unknown): TwitchHttpMethod {
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(value).toUpperCase())) {
        throw TwitchError.invalid("method 必须是 GET、POST、PUT、PATCH 或 DELETE");
    }
    return String(value).toUpperCase() as TwitchHttpMethod;
}

export function parseQuery(
    value: unknown,
): Record<string, string | number | boolean | readonly string[] | undefined> | undefined {
    if (value === undefined) return undefined;
    const data = requireObject(value, "query");
    const result: Record<string, string | number | boolean | readonly string[]> = {};
    for (const [key, item] of Object.entries(data)) {
        if (!/^[a-z][a-z0-9_]*$/u.test(key)) throw TwitchError.invalid(`query 字段 ${key} 无效`);
        if (
            typeof item === "string" ||
            typeof item === "boolean" ||
            (typeof item === "number" && Number.isFinite(item))
        ) {
            result[key] = item;
            continue;
        }
        if (Array.isArray(item) && item.every(entry => typeof entry === "string")) {
            result[key] = item as string[];
            continue;
        }
        throw TwitchError.invalid(`query.${key} 必须是标量或字符串数组`);
    }
    return result;
}
