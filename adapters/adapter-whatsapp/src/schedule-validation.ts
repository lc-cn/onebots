import {
    WHATSAPP_SCHEDULE_DAYS,
    WHATSAPP_SCHEDULE_FREQUENCIES,
    type WhatsAppScheduleDay,
    type WhatsAppScheduleRecurrence,
} from "./schedule-types.js";

export type ScheduleValidationFailure = (message: string) => never;

const IANA_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

export function scheduleRecurrence(
    value: unknown,
    fail: ScheduleValidationFailure,
): WhatsAppScheduleRecurrence {
    const source = record(value, "recurrence_pattern", fail);
    const unknown = Object.keys(source).find(
        key => !["frequency", "interval", "end_date"].includes(key),
    );
    if (unknown) fail(`recurrence_pattern 包含未知字段: ${unknown}`);
    const result: WhatsAppScheduleRecurrence = {
        ...(source.frequency === undefined
            ? {}
            : {
                  frequency: enumValue(
                      source.frequency,
                      WHATSAPP_SCHEDULE_FREQUENCIES,
                      "recurrence_pattern.frequency",
                      fail,
                  ),
              }),
        ...(source.interval === undefined
            ? {}
            : {
                  interval: positiveInteger(source.interval, "recurrence_pattern.interval", fail),
              }),
        ...(source.end_date === undefined
            ? {}
            : { end_date: calendarDate(source.end_date, "recurrence_pattern.end_date", fail) }),
    };
    if (!Object.keys(result).length) fail("recurrence_pattern 至少包含一项");
    return result;
}

export function scheduleDays(
    value: unknown,
    fail: ScheduleValidationFailure,
): WhatsAppScheduleDay[] {
    if (!Array.isArray(value) || !value.length || value.length > 7) {
        fail("days_of_week 必须包含 1 到 7 项");
    }
    const result = value.map(day => enumValue(day, WHATSAPP_SCHEDULE_DAYS, "days_of_week", fail));
    if (new Set(result).size !== result.length) fail("days_of_week 不能重复");
    return result;
}

export function scheduleClock(
    value: unknown,
    name: string,
    fail: ScheduleValidationFailure,
): string {
    const text = textValue(value, name, fail);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(text)) fail(`${name} 必须使用 HH:MM`);
    return text;
}

export function scheduleTimeZone(
    value: unknown,
    name: string,
    fail: ScheduleValidationFailure,
): string {
    const text = textValue(value, name, fail);
    if (text !== "UTC" && !IANA_TIMEZONES.has(text)) fail(`${name} 必须是有效 IANA 时区或 UTC`);
    return text;
}

export function scheduleTimestamp(
    value: unknown,
    name: string,
    fail: ScheduleValidationFailure,
): string {
    const text = textValue(value, name, fail);
    if (!Number.isFinite(Date.parse(text))) fail(`${name} 必须是有效 ISO 8601 时间`);
    return text;
}

function calendarDate(value: unknown, name: string, fail: ScheduleValidationFailure): string {
    if (typeof value !== "string") fail(`${name} 必须使用 YYYY-MM-DD`);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    if (!match) fail(`${name} 必须使用 YYYY-MM-DD`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        fail(`${name} 不是有效日期`);
    }
    return value;
}

function enumValue<T extends string>(
    value: unknown,
    allowed: readonly T[],
    name: string,
    fail: ScheduleValidationFailure,
): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
        fail(`${name} 不是受支持的值: ${String(value)}`);
    }
    return value as T;
}

function positiveInteger(value: unknown, name: string, fail: ScheduleValidationFailure): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        fail(`${name} 必须是正整数`);
    }
    return value;
}

function textValue(value: unknown, name: string, fail: ScheduleValidationFailure): string {
    if (typeof value !== "string" || !value.trim()) fail(`${name} 必须是非空字符串`);
    return value;
}

function record(
    value: unknown,
    name: string,
    fail: ScheduleValidationFailure,
): Readonly<Record<string, unknown>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} 必须是对象`);
    return value as Readonly<Record<string, unknown>>;
}
