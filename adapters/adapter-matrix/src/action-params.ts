import { MatrixError } from "./errors.js";
import { isRecord } from "./validation.js";

export function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) throw MatrixError.invalid(`${field} 必须是非空字符串`);
    return value;
}

export function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    return requireString(value, field);
}

export function requireObject(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw MatrixError.invalid(`${field} 必须是对象`);
    return value;
}

export function optionalObject(value: unknown, field: string): Record<string, unknown> {
    return value === undefined ? {} : requireObject(value, field);
}

export function requireMethod(value: unknown): string {
    const method = requireString(value, "method").toUpperCase();
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) {
        throw MatrixError.invalid("method 仅支持 GET、POST、PUT、DELETE");
    }
    return method;
}

export function requireBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw MatrixError.invalid(`${field} 必须是布尔值`);
    return value;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
    return value === undefined ? undefined : requireBoolean(value, field);
}

export function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        throw MatrixError.invalid(`${field} 必须是非负安全整数`);
    }
    return Number(value);
}
