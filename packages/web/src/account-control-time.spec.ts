import { describe, expect, it } from "vitest";
import { formatAccountMessageTime } from "./account-control-time.js";

const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    dateStyle: "short",
    timeStyle: "short",
});

describe("账号控制消息时间", () => {
    it("有效时间同时提供可读文本和机器时间", () => {
        const time = Date.UTC(2026, 8, 26, 10, 30);
        expect(formatAccountMessageTime(time, formatter)).toEqual({
            datetime: "2026-09-26T10:30:00.000Z",
            label: formatter.format(time),
        });
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, 9e15])(
        "越界时间只显示占位，不抛错: %s",
        value => {
            expect(formatAccountMessageTime(value, formatter)).toEqual({ label: "时间未知" });
        },
    );
});
