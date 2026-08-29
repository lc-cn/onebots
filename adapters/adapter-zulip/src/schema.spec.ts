import { describe, expect, it } from "vitest";
import { zulipSchema } from "./index.js";

describe("Zulip Schema", () => {
    it("只在启用队列时展示事件过滤与重试配置", () => {
        const queue = zulipSchema.event_queue;
        expect("type" in queue).toBe(false);
        if ("type" in queue) return;
        for (const field of [
            queue.event_types,
            queue.all_public_streams,
            queue.retry_initial_delay_ms,
            queue.retry_max_delay_ms,
        ]) {
            expect(field.ui?.visibleWhen).toEqual({
                path: "event_queue.enabled",
                oneOf: [true],
            });
        }
    });
});
