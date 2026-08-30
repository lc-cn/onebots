import {
    invalidParams,
    optionalIntegerInRange,
    requireBoundedString,
    requirePositiveInteger,
} from "./platform-action-params.js";
import { optionalLineDate, requireLineDate } from "./messaging-action-params.js";

const DAY_MILLISECONDS = 86_400_000;

export function membershipId(params: Readonly<Record<string, unknown>>): number {
    return requirePositiveInteger(params, "membership_id");
}

export function membershipLimit(params: Readonly<Record<string, unknown>>): number | undefined {
    return optionalIntegerInRange(params, "limit", 1, 1000);
}

export function followerDate(params: Readonly<Record<string, unknown>>): string | undefined {
    return optionalLineDate(params);
}

export function aggregationUnit(params: Readonly<Record<string, unknown>>): string {
    return requireBoundedString(params, "unit", 30);
}

export function requireLineDateRange(
    params: Readonly<Record<string, unknown>>,
    maximumDistanceDays: number,
): readonly [from: string, to: string] {
    const from = requireLineDate(params, "from");
    const to = requireLineDate(params, "to");
    const distance = (toTimestamp(to) - toTimestamp(from)) / DAY_MILLISECONDS;
    if (distance < 0) throw invalidParams("LINE 参数 to 不能早于 from");
    if (distance > maximumDistanceDays) {
        throw invalidParams(`LINE 日期范围最多跨越 ${maximumDistanceDays} 天`);
    }
    return [from, to];
}

function toTimestamp(value: string): number {
    return Date.UTC(
        Number(value.slice(0, 4)),
        Number(value.slice(4, 6)) - 1,
        Number(value.slice(6, 8)),
    );
}
