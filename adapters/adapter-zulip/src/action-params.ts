import { ZulipError } from "./errors.js";
import type { ZulipHttpMethod, ZulipParam, ZulipParams } from "./types.js";

export function requireMethod(value: unknown): ZulipHttpMethod {
    if (value === undefined) return "GET";
    if (value === "GET" || value === "POST" || value === "PATCH" || value === "DELETE") {
        return value;
    }
    invalid("Zulip method 必须是 GET、POST、PATCH 或 DELETE");
}

export function requireParams(value: unknown): ZulipParams {
    const source = isRecord(value) && "params" in value ? value.params : value;
    if (!isRecord(source)) invalid("Zulip params 必须是对象");
    const result: Record<string, ZulipParam | undefined> = {};
    for (const [key, item] of Object.entries(source)) {
        if (!isZulipParam(item)) invalid(`Zulip 参数 ${key} 不是可编码的值`);
        result[key] = item;
    }
    return result;
}

export function exactParams(
    value: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
    required: readonly string[] = [],
): ZulipParams {
    const fields = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!fields.has(key)) invalid(`Zulip 动作不接受参数 ${key}`);
    }
    for (const key of required) {
        if (value[key] === undefined) invalid(`Zulip 动作缺少参数 ${key}`);
    }
    return requireParams(value);
}

export function without(
    value: Readonly<Record<string, unknown>>,
    ...keys: readonly string[]
): ZulipParams {
    const copy = { ...value };
    for (const key of keys) delete copy[key];
    return requireParams(copy);
}

export function requireString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) {
        invalid(`Zulip 参数 ${name} 必须是非空字符串`);
    }
    return value;
}

export function requireText(value: unknown, name: string): string {
    if (typeof value !== "string") invalid(`Zulip 参数 ${name} 必须是字符串`);
    return value;
}

export function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

export function requireInteger(value: unknown, name: string): number {
    const result = typeof value === "string" ? Number(value) : value;
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) {
        invalid(`Zulip 参数 ${name} 必须是非负整数`);
    }
    return result;
}

export function requireIntegerArray(value: unknown, name: string): readonly number[] {
    if (!Array.isArray(value) || !value.every(item => Number.isSafeInteger(item) && item >= 0)) {
        invalid(`Zulip 参数 ${name} 必须是非负整数数组`);
    }
    return value;
}

export function requireBoolean(value: unknown, name: string): boolean {
    if (typeof value !== "boolean") invalid(`Zulip 参数 ${name} 必须是布尔值`);
    return value;
}

export function assertHasAny(value: ZulipParams, fields: readonly string[]): void {
    if (!fields.some(field => value[field] !== undefined)) {
        invalid(`Zulip 动作至少需要一个参数：${fields.join("、")}`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isZulipParam(value: unknown): value is ZulipParam | undefined {
    return (
        value === undefined ||
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        Array.isArray(value) ||
        isRecord(value)
    );
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
