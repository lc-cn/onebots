import type { messagingApi } from "@line/bot-sdk";
import { LineApiError } from "./errors.js";

export async function streamResult(
    stream: NodeJS.ReadableStream,
): Promise<{ data_base64: string }> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
        else if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    }
    return { data_base64: Buffer.concat(chunks).toString("base64") };
}

export function base64Blob(params: Readonly<Record<string, unknown>>): Blob {
    const data = Buffer.from(requireString(params, "data_base64"), "base64");
    return new Blob([data], { type: optionalString(params, "content_type") || "image/png" });
}

export function couponStatuses(
    params: Readonly<Record<string, unknown>>,
): Set<"DRAFT" | "RUNNING" | "CLOSED"> | undefined {
    const values = optionalStringArray(params, "status");
    if (!values) return undefined;
    const allowed = new Set(["DRAFT", "RUNNING", "CLOSED"]);
    if (!values.every(value => allowed.has(value))) {
        throw invalidParams("LINE 参数 status 只能包含 DRAFT/RUNNING/CLOSED");
    }
    return new Set(values as Array<"DRAFT" | "RUNNING" | "CLOSED">);
}

export function requireMessages(params: Readonly<Record<string, unknown>>): messagingApi.Message[] {
    const messages = params.messages;
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 5) {
        throw invalidParams("LINE 参数 messages 必须包含 1 到 5 条消息");
    }
    if (!messages.every(value => value && typeof value === "object" && !Array.isArray(value))) {
        throw invalidParams("LINE 参数 messages 必须是消息对象数组");
    }
    return structuredClone(messages) as messagingApi.Message[];
}

export function requireRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, unknown> {
    const value = params[name];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalidParams(`LINE 参数 ${name} 必须是对象`);
    }
    return structuredClone(value as Record<string, unknown>);
}

export function requireString(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = optionalString(params, name);
    if (!value) throw invalidParams(`LINE 参数 ${name} 必须是非空字符串`);
    return value;
}

export function requireHttpsUrl(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = requireString(params, name);
    if (!URL.canParse(value) || new URL(value).protocol !== "https:") {
        throw invalidParams(`LINE 参数 ${name} 必须是有效 HTTPS URL`);
    }
    return value;
}

export function optionalString(
    params: Readonly<Record<string, unknown>>,
    name: string,
): string | undefined {
    const value = params[name];
    return typeof value === "string" && value ? value : undefined;
}

export function requireStringArray(
    params: Readonly<Record<string, unknown>>,
    name: string,
): string[] {
    const value = optionalStringArray(params, name);
    if (!value?.length) throw invalidParams(`LINE 参数 ${name} 必须是非空字符串数组`);
    return value;
}

export function optionalStringArray(
    params: Readonly<Record<string, unknown>>,
    name: string,
): string[] | undefined {
    const value = params[name];
    return Array.isArray(value) && value.every(item => typeof item === "string")
        ? value
        : undefined;
}

export function optionalBoolean(
    params: Readonly<Record<string, unknown>>,
    name: string,
): boolean | undefined {
    const value = params[name];
    return typeof value === "boolean" ? value : undefined;
}

export function optionalNumber(
    params: Readonly<Record<string, unknown>>,
    name: string,
): number | undefined {
    const value = params[name];
    if (value == null) return undefined;
    const number = Number(value);
    if (!Number.isFinite(number)) throw invalidParams(`LINE 参数 ${name} 必须是数字`);
    return number;
}

export function requireInteger(params: Readonly<Record<string, unknown>>, name: string): number {
    const value = optionalNumber(params, name);
    if (value === undefined || !Number.isSafeInteger(value)) {
        throw invalidParams(`LINE 参数 ${name} 必须是整数`);
    }
    return value;
}

function invalidParams(message: string): LineApiError {
    return new LineApiError(message, { code: "LINE_INVALID_ACTION_PARAMS" });
}
