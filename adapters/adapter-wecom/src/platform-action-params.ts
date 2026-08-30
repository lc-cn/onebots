import type { WeComClient } from "./client.js";
import { WeComApiError } from "./errors.js";
import type { WeComActionHandler, WeComActionParams } from "./platform-action-context.js";
import type { WeComCallOptions } from "./types.js";

export function callOptions(params: WeComActionParams): WeComCallOptions {
    const method = optionalString(params, "method")?.toUpperCase();
    if (method && method !== "GET" && method !== "POST") invalid("method 必须是 GET 或 POST");
    const responseType = optionalString(params, "response_type");
    if (responseType && responseType !== "json" && responseType !== "buffer") {
        invalid("response_type 必须是 json 或 buffer");
    }
    return {
        method: method as WeComCallOptions["method"],
        path: requireString(params, "path"),
        query: scalarRecord(params, "query"),
        body: params.body,
        token: optionalBoolean(params, "token"),
        response_type: responseType as WeComCallOptions["response_type"],
    };
}

export function post(client: WeComClient, path: string, body: unknown): Promise<unknown> {
    return client.call({ method: "POST", path, body });
}

export function postRecordAction(path: string, parameter: string): WeComActionHandler {
    return async (client, params) => post(client, path, requireRecord(params, parameter));
}

export function staticCall(path: string): WeComActionHandler {
    return async client => client.call({ path });
}

export function stringQueryAction(
    path: string,
    parameter: string,
    query: string,
): WeComActionHandler {
    return async (client, params) =>
        client.call({ path, query: { [query]: requireString(params, parameter) } });
}

export function numberQueryAction(
    path: string,
    parameter: string,
    query: string,
): WeComActionHandler {
    return async (client, params) =>
        client.call({ path, query: { [query]: requireNumber(params, parameter) } });
}

export function requireString(params: WeComActionParams, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value) invalid(`${name} 必须是非空字符串`);
    return value;
}

export function optionalString(params: WeComActionParams, name: string): string | undefined {
    const value = params[name];
    return typeof value === "string" && value ? value : undefined;
}

export function requireNumber(params: WeComActionParams, name: string): number {
    const value = params[name];
    if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${name} 必须是数字`);
    return value;
}

export function optionalNumber(params: WeComActionParams, name: string): number | undefined {
    const value = params[name];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function optionalBoolean(params: WeComActionParams, name: string): boolean | undefined {
    return typeof params[name] === "boolean" ? params[name] : undefined;
}

export function requireRecord(params: WeComActionParams, name: string): Record<string, unknown> {
    const value = params[name];
    if (!isRecord(value)) invalid(`${name} 必须是对象`);
    return structuredClone(value);
}

export function optionalRecord(
    params: WeComActionParams,
    name: string,
): Record<string, unknown> | undefined {
    if (params[name] === undefined) return undefined;
    return requireRecord(params, name);
}

export function requireStringArray(params: WeComActionParams, name: string): string[] {
    const result = stringArray(params, name);
    if (!result.length) invalid(`${name} 必须是非空字符串数组`);
    return result;
}

export function stringArray(params: WeComActionParams, name: string): string[] {
    const value = params[name];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item)) {
        invalid(`${name} 必须是字符串数组`);
    }
    return [...value] as string[];
}

export function numberArray(params: WeComActionParams, name: string): number[] {
    const value = params[name];
    if (value === undefined) return [];
    if (
        !Array.isArray(value) ||
        value.some(item => typeof item !== "number" || !Number.isFinite(item))
    ) {
        invalid(`${name} 必须是数字数组`);
    }
    return [...value] as number[];
}

export function boundedInteger(
    params: WeComActionParams,
    name: string,
    minimum: number,
    maximum: number,
    fallback: number,
): number {
    const value = params[name] ?? fallback;
    if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        invalid(`${name} 必须是 ${minimum} 到 ${maximum} 的整数`);
    }
    return value as number;
}

function scalarRecord(
    params: WeComActionParams,
    name: string,
): Record<string, string | number | boolean | undefined> | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (!isRecord(value)) invalid(`${name} 必须是对象`);
    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, item] of Object.entries(value)) {
        if (
            item !== undefined &&
            typeof item !== "string" &&
            typeof item !== "number" &&
            typeof item !== "boolean"
        ) {
            invalid(`${name}.${key} 必须是标量`);
        }
        result[key] = item as string | number | boolean | undefined;
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function invalid(message: string): never {
    throw new WeComApiError(`企业微信 ${message}`, { code: "WECOM_INVALID_PARAMETER" });
}
