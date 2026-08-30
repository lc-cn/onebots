import type { CommonTypes } from "onebots";
import { invalidICQQParam } from "./errors.js";

/** ICQQ 消息段的统一运行时边界，避免各元素重复宽松断言。 */
export function requireRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) throw invalidICQQParam(`${field} 必须是对象`, value);
    return value;
}

export function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) {
        throw invalidICQQParam(`${field} 必须是非空字符串`, value);
    }
    return value;
}

export function optionalString(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : requireString(value, field);
}

export function requireInteger(value: unknown, field: string): number {
    const number = typeof value === "string" && value.trim() ? Number(value) : value;
    if (typeof number !== "number" || !Number.isSafeInteger(number)) {
        throw invalidICQQParam(`${field} 必须是安全整数`, value);
    }
    return number;
}

export function optionalInteger(value: unknown, field: string): number | undefined {
    return value === undefined ? undefined : requireInteger(value, field);
}

export function requireFiniteNumber(value: unknown, field: string): number {
    const number = typeof value === "string" && value.trim() ? Number(value) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) {
        throw invalidICQQParam(`${field} 必须是有限数字`, value);
    }
    return number;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") throw invalidICQQParam(`${field} 必须是布尔值`, value);
    return value;
}

export function optionalStringArray(value: unknown, field: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw invalidICQQParam(`${field} 必须是字符串数组`, value);
    return value.map(item => requireString(item, field));
}

export function requireSegments(value: unknown, field: string): CommonTypes.Segment[] {
    if (!Array.isArray(value)) throw invalidICQQParam(`${field} 必须是消息段数组`, value);
    return value.map((item, index) => {
        const segment = requireRecord(item, `${field}[${index}]`);
        return {
            type: requireString(segment.type, `${field}[${index}].type`),
            data: requireRecord(segment.data, `${field}[${index}].data`),
        };
    });
}

export function requirePresent(value: unknown, field: string): unknown {
    if (value === undefined) throw invalidICQQParam(`${field} 不能为空`, value);
    return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
