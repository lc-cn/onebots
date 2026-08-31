import { describe, expect, it } from "vitest";
import { RecentEventDeduplicator } from "../recent-event-deduplicator.js";

describe("RecentEventDeduplicator", () => {
    it("只把显式提交的事件视为已处理", () => {
        const deduplicator = new RecentEventDeduplicator<string>();
        expect(deduplicator.has("event")).toBe(false);
        deduplicator.commit("event");
        expect(deduplicator.has("event")).toBe(true);
    });

    it("过期后允许同一事件重新处理", () => {
        let now = 100;
        const deduplicator = new RecentEventDeduplicator<string>({ ttlMs: 10, now: () => now });
        deduplicator.commit("event");
        now = 111;
        expect(deduplicator.has("event")).toBe(false);
    });

    it("按提交顺序限制内存窗口", () => {
        const deduplicator = new RecentEventDeduplicator<string>({ maxEntries: 2 });
        deduplicator.commit("first");
        deduplicator.commit("second");
        deduplicator.commit("third");
        expect(deduplicator.has("first")).toBe(false);
        expect(deduplicator.has("second")).toBe(true);
        expect(deduplicator.has("third")).toBe(true);
    });
});
