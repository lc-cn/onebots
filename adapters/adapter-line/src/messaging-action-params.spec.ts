import { describe, expect, it } from "vitest";
import { collectCursorPages } from "./cursor-pages.js";
import {
    aggregationLimit,
    customAggregationUnits,
    loadingSeconds,
    multicastRecipients,
    narrowcastRequest,
    optionalRetryKey,
    pnpMessagesRequest,
    requireLineDate,
} from "./messaging-action-params.js";

describe("LINE 消息动作参数", () => {
    it("闭合重试键与聚合单位", () => {
        expect(optionalRetryKey({ retry_key: "123e4567-e89b-42d3-a456-426614174000" })).toBe(
            "123e4567-e89b-42d3-a456-426614174000",
        );
        expect(customAggregationUnits({ custom_aggregation_units: ["campaign"] })).toEqual([
            "campaign",
        ]);
        expect(() => optionalRetryKey({ retry_key: "retry" })).toThrow(/UUID/u);
        expect(() => customAggregationUnits({ custom_aggregation_units: [] })).toThrow(/必须包含 1 个/u);
        expect(() => customAggregationUnits({ custom_aggregation_units: ["a", "b"] })).toThrow(
            /必须包含 1 个/u,
        );
    });

    it("限制 multicast 用户数量并拒绝重复 ID", () => {
        expect(multicastRecipients({ to: ["U1", "U2"] })).toEqual(["U1", "U2"]);
        expect(() => multicastRecipients({ to: ["U1", "U1"] })).toThrow(/重复/u);
        expect(() =>
            multicastRecipients({ to: Array.from({ length: 501 }, (_, index) => `U${index}`) }),
        ).toThrow(/500/u);
    });

    it("校验 loading 秒数、日期与整数分页", () => {
        expect(loadingSeconds({ loading_seconds: 15 })).toBe(15);
        expect(aggregationLimit({ limit: 100 })).toBe("100");
        expect(requireLineDate({ date: "20240229" })).toBe("20240229");
        expect(() => loadingSeconds({ loading_seconds: 12 })).toThrow(/5 的倍数/u);
        expect(() => loadingSeconds({ loading_seconds: 65 })).toThrow(/5 到 60/u);
        expect(() => requireLineDate({ date: "20230229" })).toThrow(/有效日期/u);
        expect(() => aggregationLimit({ limit: "100" })).toThrow(/数字/u);
    });

    it("闭合 narrowcast 与 PNP 请求体", () => {
        expect(
            narrowcastRequest({
                request: {
                    messages: [{ type: "text", text: "hello" }],
                    notificationDisabled: true,
                },
            }),
        ).toMatchObject({ notificationDisabled: true });
        expect(() =>
            narrowcastRequest({ request: { messages: [{ type: "text" }], extra: true } }),
        ).toThrow(/不接受参数 extra/u);

        const to = "a".repeat(64);
        expect(
            pnpMessagesRequest({
                request: { to, messages: [{ type: "text", text: "hello" }] },
            }),
        ).toMatchObject({ to });
        expect(() =>
            pnpMessagesRequest({ request: { to: "phone", messages: [{ type: "text" }] } }),
        ).toThrow(/SHA-256/u);
    });
});

describe("collectCursorPages", () => {
    it("按游标收集全部页面", async () => {
        const cursors: Array<string | undefined> = [];
        await expect(
            collectCursorPages(undefined, async cursor => {
                cursors.push(cursor);
                return cursor
                    ? { items: ["U2"] }
                    : { items: ["U1"], next: "next-page" };
            }),
        ).resolves.toEqual(["U1", "U2"]);
        expect(cursors).toEqual([undefined, "next-page"]);
    });

    it("拒绝服务端重复游标", async () => {
        await expect(
            collectCursorPages(undefined, async () => ({ items: [], next: "same" })),
        ).rejects.toMatchObject({ code: "LINE_INVALID_ACTION_PARAMS" });
    });
});
