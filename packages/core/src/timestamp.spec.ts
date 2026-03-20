import { describe, it, expect } from "vitest";
import {
    UNIX_TIMESTAMP_MS_MIN,
    unixSecondsToEventMs,
    unixMillisToEventMs,
    coerceUnixToEventMs,
    toUnixSeconds,
    dateLikeToEventMs,
} from "./timestamp.js";

describe("timestamp", () => {
    describe("unixSecondsToEventMs", () => {
        it("秒转毫秒", () => {
            expect(unixSecondsToEventMs(1)).toBe(1000);
            expect(unixSecondsToEventMs(1700000000)).toBe(1700000000 * 1000);
        });

        it("数字字符串", () => {
            expect(unixSecondsToEventMs("1700000000")).toBe(1700000000 * 1000);
        });

        it("无效时用 fallback", () => {
            expect(unixSecondsToEventMs(undefined, { fallbackMs: 42 })).toBe(42);
            expect(unixSecondsToEventMs("", { fallbackMs: 42 })).toBe(42);
            expect(unixSecondsToEventMs(NaN, { fallbackMs: 42 })).toBe(42);
            expect(unixSecondsToEventMs(-1, { fallbackMs: 42 })).toBe(42);
        });
    });

    describe("unixMillisToEventMs", () => {
        it("毫秒取整", () => {
            expect(unixMillisToEventMs(1700000000123)).toBe(1700000000123);
        });

        it("无效时用 fallback", () => {
            expect(unixMillisToEventMs(undefined, { fallbackMs: 99 })).toBe(99);
        });
    });

    describe("coerceUnixToEventMs", () => {
        it("大数视为毫秒", () => {
            const ms = UNIX_TIMESTAMP_MS_MIN * 1000 + 1;
            expect(coerceUnixToEventMs(ms)).toBe(ms);
        });

        it("小数视为秒", () => {
            expect(coerceUnixToEventMs(1700000000)).toBe(1700000000 * 1000);
        });
    });

    describe("toUnixSeconds", () => {
        it("有效秒", () => {
            expect(toUnixSeconds(1700000000)).toBe(1700000000);
        });

        it("无效时用 fallbackSec", () => {
            expect(toUnixSeconds(undefined, { fallbackSec: 123 })).toBe(123);
        });
    });

    describe("dateLikeToEventMs", () => {
        it("解析 ISO 字符串为毫秒", () => {
            expect(dateLikeToEventMs("2024-01-02T03:04:05.000Z")).toBe(
                new Date("2024-01-02T03:04:05.000Z").getTime(),
            );
        });

        it("非法日期用 fallback", () => {
            expect(dateLikeToEventMs("not-a-date", { fallbackMs: 7 })).toBe(7);
        });
    });
});
