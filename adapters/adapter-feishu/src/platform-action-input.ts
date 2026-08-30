import { isSafeAbsoluteApiPath } from "onebots";
import { invalidFeishuParam } from "./errors.js";

export type FeishuActionParams = Readonly<Record<string, unknown>>;
export type FeishuHttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export function requirePath(value: unknown): string {
    if (typeof value !== "string" || !isSafeAbsoluteApiPath(value)) {
        throw invalidFeishuParam("飞书参数 path 必须为安全绝对路径", value);
    }
    return value;
}

export function requireMethod(value: unknown): FeishuHttpMethod {
    if (value === undefined) return "GET";
    if (typeof value !== "string" || !value) {
        throw invalidFeishuParam("飞书参数 method 必须为非空字符串", value);
    }
    const method = value.toUpperCase();
    if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method)) {
        throw invalidFeishuParam("飞书参数 method 不是受支持的 HTTP 方法", value);
    }
    return method as FeishuHttpMethod;
}

export function requiredString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value) {
        throw invalidFeishuParam(`飞书参数 ${name} 必须为非空字符串`, value);
    }
    return value;
}

export function optionalString(value: unknown, name: string): string | undefined {
    return value === undefined ? undefined : requiredString(value, name);
}

export function optionalStringParam(value: unknown, name: string): Record<string, string> {
    const result = optionalString(value, name);
    return result === undefined ? {} : { [name]: result };
}

export function segment(params: FeishuActionParams, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value || !/^[A-Za-z0-9._:-]+$/.test(value)) {
        throw invalidFeishuParam(`飞书参数 ${name} 必须为合法 ID`, value);
    }
    return encodeURIComponent(value);
}

export function bodyValue(value: unknown): Record<string, unknown> | undefined {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw invalidFeishuParam("飞书参数 body 必须为对象", value);
    }
    return value as Record<string, unknown>;
}

export function queryValue(
    value: FeishuActionParams | unknown,
): Record<string, string | number | boolean> | undefined {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw invalidFeishuParam("飞书参数 query 必须为对象", value);
    }
    const query: Record<string, string | number | boolean> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!["string", "number", "boolean"].includes(typeof item)) {
            throw invalidFeishuParam(`飞书 query 参数 ${key} 必须为标量`, item);
        }
        query[key] = item as string | number | boolean;
    }
    return query;
}

export function without(params: FeishuActionParams, ...keys: string[]): Record<string, unknown> {
    return Object.fromEntries(Object.entries(params).filter(([key]) => !keys.includes(key)));
}

export function receiveIdType(value: unknown): string {
    return enumString(
        value,
        "receive_id_type",
        ["open_id", "user_id", "union_id", "email", "chat_id", "thread_id"],
        "open_id",
    );
}

export function userIdType(value: unknown): string {
    return enumString(value, "user_id_type", ["open_id", "user_id", "union_id"], "open_id");
}

export function memberIdType(value: unknown): string {
    return enumString(
        value,
        "member_id_type",
        ["open_id", "user_id", "union_id", "app_id"],
        "open_id",
    );
}

export function enumString<T extends string>(
    value: unknown,
    name: string,
    allowed: readonly T[],
    fallback?: T,
): T {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== "string" || !allowed.includes(value as T)) {
        throw invalidFeishuParam(`飞书参数 ${name} 必须是 ${allowed.join("、")} 之一`, value);
    }
    return value as T;
}

export function optionalBoolean(value: unknown, name: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") {
        throw invalidFeishuParam(`飞书参数 ${name} 必须为布尔值`, value);
    }
    return value;
}

export function optionalNumber(value: unknown, name: string): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw invalidFeishuParam(`飞书参数 ${name} 必须为有限数字`, value);
    }
    return value;
}

export function requiredSequence(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw invalidFeishuParam("飞书参数 sequence 必须为非负安全整数", value);
    }
    return value;
}

export function compactQuery(
    value: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> {
    return Object.fromEntries(
        Object.entries(value).filter(
            (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
        ),
    );
}

export function stringArray(value: unknown, name: string): string[] {
    if (
        !Array.isArray(value) ||
        !value.length ||
        !value.every(item => typeof item === "string" && item)
    ) {
        throw invalidFeishuParam(`飞书参数 ${name} 必须为非空字符串数组`, value);
    }
    return value;
}

export function requiredRecord(value: unknown, name: string): Record<string, unknown> {
    if (!isPlainRecord(value) || !Object.keys(value).length) {
        throw invalidFeishuParam(`飞书参数 ${name} 必须为非空普通对象`, value);
    }
    return value;
}

export function requiredRecordArray(value: unknown, name: string): Record<string, unknown>[] {
    if (!Array.isArray(value) || !value.length || !value.every(isPlainRecord)) {
        throw invalidFeishuParam(`飞书参数 ${name} 必须为非空普通对象数组`, value);
    }
    return value;
}

export function jsonObjectString(value: unknown, name: string): string {
    const record = requiredRecord(value, name);
    assertJsonValue(record, name, new WeakSet<object>());
    return JSON.stringify(record);
}

export function jsonRecordArrayString(value: unknown, name: string): string {
    const records = requiredRecordArray(value, name);
    assertJsonValue(records, name, new WeakSet<object>());
    return JSON.stringify(records);
}

function assertJsonValue(value: unknown, name: string, seen: WeakSet<object>): void {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object") {
        throw invalidFeishuParam(`飞书参数 ${name} 只能包含 JSON 值`, value);
    }
    if (seen.has(value)) throw invalidFeishuParam(`飞书参数 ${name} 不能包含循环引用`);
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) assertJsonValue(item, name, seen);
    } else {
        if (!isPlainRecord(value)) {
            throw invalidFeishuParam(`飞书参数 ${name} 只能包含普通对象`, value);
        }
        for (const item of Object.values(value)) assertJsonValue(item, name, seen);
    }
    seen.delete(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
