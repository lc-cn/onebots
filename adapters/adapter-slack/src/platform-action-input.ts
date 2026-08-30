import { SlackError } from "./errors.js";

export type SlackActionParams = Readonly<Record<string, unknown>>;

export function requiredSlackString(value: unknown, name: string, maxLength?: number): string {
    if (typeof value !== "string" || !value.trim() || (maxLength && value.length > maxLength)) {
        throw SlackError.invalid(`Slack 参数 ${name} 无效`, "SLACK_PARAM_INVALID", {
            name,
            max_length: maxLength,
        });
    }
    return value;
}

export function optionalSlackString(
    params: SlackActionParams,
    name: string,
    maxLength?: number,
): Record<string, string> {
    return params[name] === undefined
        ? {}
        : { [name]: requiredSlackString(params[name], name, maxLength) };
}

export function optionalSlackNullableString(
    params: SlackActionParams,
    name: string,
    maxLength?: number,
): Record<string, string | null> {
    const value = params[name];
    if (value === undefined) return {};
    return { [name]: value === null ? null : requiredSlackString(value, name, maxLength) };
}

export function requiredSlackRecord(value: unknown, name: string): Record<string, unknown> {
    if (!isSlackRecord(value)) {
        throw SlackError.invalid(`Slack 参数 ${name} 必须为对象`, "SLACK_PARAM_INVALID", {
            name,
        });
    }
    return value;
}

export function isSlackRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
