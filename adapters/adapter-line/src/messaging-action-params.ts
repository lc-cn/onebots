import type { messagingApi } from "@line/bot-sdk";
import {
    exactParams,
    invalidParams,
    optionalBoolean,
    optionalIntegerInRange,
    optionalString,
    optionalStringArray,
    requireMessages,
    requireRecord,
    requireString,
    requireStringArray,
} from "./platform-action-params.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export function optionalRetryKey(
    params: Readonly<Record<string, unknown>>,
): string | undefined {
    const value = optionalString(params, "retry_key");
    if (value && !UUID_PATTERN.test(value)) {
        throw invalidParams("LINE 参数 retry_key 必须是规范 UUID");
    }
    return value;
}

export function customAggregationUnits(
    params: Readonly<Record<string, unknown>>,
): string[] | undefined {
    const values = optionalStringArray(params, "custom_aggregation_units");
    if (!values) return undefined;
    if (values.length !== 1 || values[0].length > 30) {
        throw invalidParams("LINE 参数 custom_aggregation_units 必须包含 1 个不超过 30 字符的名称");
    }
    return values;
}

export function multicastRecipients(params: Readonly<Record<string, unknown>>): string[] {
    const values = requireStringArray(params, "to");
    if (values.length > 500) throw invalidParams("LINE 参数 to 最多包含 500 个用户 ID");
    if (new Set(values).size !== values.length) {
        throw invalidParams("LINE 参数 to 不能包含重复用户 ID");
    }
    return values;
}

export function loadingSeconds(
    params: Readonly<Record<string, unknown>>,
): number | undefined {
    const value = optionalIntegerInRange(params, "loading_seconds", 5, 60);
    if (value !== undefined && value % 5 !== 0) {
        throw invalidParams("LINE 参数 loading_seconds 必须是 5 的倍数");
    }
    return value;
}

export function followersLimit(
    params: Readonly<Record<string, unknown>>,
): number | undefined {
    return optionalIntegerInRange(params, "limit", 1, 1000);
}

/** SDK 将查询参数声明成字符串；平台动作对外保持整数语义。 */
export function aggregationLimit(
    params: Readonly<Record<string, unknown>>,
): string | undefined {
    return optionalIntegerInRange(params, "limit", 1, 1000)?.toString();
}

export function requireLineDate(
    params: Readonly<Record<string, unknown>>,
    name = "date",
): string {
    const value = requireString(params, name);
    if (!/^\d{8}$/u.test(value)) throw invalidParams(`LINE 参数 ${name} 必须使用 yyyyMMdd 格式`);
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        throw invalidParams(`LINE 参数 ${name} 必须是有效日期`);
    }
    return value;
}

export function narrowcastRequest(
    params: Readonly<Record<string, unknown>>,
): messagingApi.NarrowcastRequest {
    const request = requireRecord(params, "request");
    exactParams(request, ["messages", "recipient", "filter", "limit", "notificationDisabled"]);
    requireMessages(request);
    optionalBoolean(request, "notificationDisabled");
    for (const field of ["recipient", "filter", "limit"] as const) {
        if (request[field] !== undefined) requireRecord(request, field);
    }
    return request as messagingApi.NarrowcastRequest;
}

export function pnpMessagesRequest(
    params: Readonly<Record<string, unknown>>,
): messagingApi.PnpMessagesRequest {
    const request = requireRecord(params, "request");
    exactParams(request, ["to", "messages", "notificationDisabled"]);
    const to = requireString(request, "to");
    if (!SHA256_PATTERN.test(to)) {
        throw invalidParams("LINE PNP 参数 to 必须是 E.164 电话号码的 64 位小写 SHA-256 值");
    }
    return {
        to,
        messages: requireMessages(request),
        notificationDisabled: optionalBoolean(request, "notificationDisabled"),
    };
}
