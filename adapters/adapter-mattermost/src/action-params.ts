import { MattermostError } from "./errors.js";
import type { MattermostHttpMethod } from "./types.js";
import { isRecord } from "./validation.js";

export function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw MattermostError.invalid(`${field} 必须是非空字符串`);
    }
    return value;
}

export function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw MattermostError.invalid(`${field} 必须是字符串`);
    return value;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") throw MattermostError.invalid(`${field} 必须是布尔值`);
    return value;
}

export function optionalInteger(
    value: unknown,
    field: string,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
        throw MattermostError.invalid(`${field} 必须是 ${min} 到 ${max} 的整数`);
    }
    return Number(value);
}

export function requireObject(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw MattermostError.invalid(`${field} 必须是对象`);
    return value;
}

export function optionalObject(value: unknown, field: string): Record<string, unknown> {
    return value === undefined ? {} : requireObject(value, field);
}

export function requireStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item)) {
        throw MattermostError.invalid(`${field} 必须是非空字符串数组`);
    }
    return value;
}

export function requireMethod(value: unknown): MattermostHttpMethod {
    if (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(value))) {
        return value as MattermostHttpMethod;
    }
    throw MattermostError.invalid("method 必须是 GET、POST、PUT、PATCH 或 DELETE");
}

export function parseQuery(value: unknown): Record<string, string | number | boolean | undefined> {
    const record = optionalObject(value, "query");
    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, item] of Object.entries(record)) {
        if (
            !["string", "number", "boolean", "undefined"].includes(typeof item) ||
            (typeof item === "number" && !Number.isFinite(item))
        ) {
            throw MattermostError.invalid(`query.${key} 必须是标量`);
        }
        result[key] = item as string | number | boolean | undefined;
    }
    return result;
}
