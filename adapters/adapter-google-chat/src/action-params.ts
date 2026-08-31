import { GoogleChatError } from "./errors.js";
import { isRecord, requireString } from "./validation.js";

export { requireString };

export function requireMethod(value: unknown): string {
    const method = requireString(value, "method").toUpperCase();
    if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) {
        throw GoogleChatError.invalid("method 仅支持 GET、POST、PATCH、DELETE");
    }
    return method;
}

export function optionalObject(value: unknown, field: string): Record<string, unknown> {
    if (value === undefined) return {};
    if (!isRecord(value)) throw GoogleChatError.invalid(`${field} 必须是对象`);
    return value;
}

export function optionalString(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : requireString(value, field);
}

export function optionalInteger(value: unknown, field: string): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        throw GoogleChatError.invalid(`${field} 必须是非负安全整数`);
    }
    return Number(value);
}

export function parseQuery(
    value: unknown,
): Record<string, string | number | boolean | readonly string[] | undefined> {
    const input = optionalObject(value, "query");
    const result: Record<string, string | number | boolean | readonly string[] | undefined> = {};
    for (const [key, item] of Object.entries(input)) {
        if (Array.isArray(item)) {
            if (item.some(entry => typeof entry !== "string")) {
                throw GoogleChatError.invalid(`query.${key} 数组只能包含字符串`);
            }
            result[key] = item;
            continue;
        }
        if (
            !["string", "number", "boolean", "undefined"].includes(typeof item) ||
            (typeof item === "number" && !Number.isFinite(item))
        ) {
            throw GoogleChatError.invalid(`query.${key} 必须是标量`);
        }
        result[key] = item as string | number | boolean | undefined;
    }
    return result;
}
