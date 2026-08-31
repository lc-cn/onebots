import { describe, expect, it } from "vitest";
import { zulipSchema } from "./index.js";

describe("Zulip Schema", () => {
    it("使用统一接收模式并只在队列模式展示事件过滤与重试配置", () => {
        const queue = zulipSchema.event_queue;
        expect("type" in queue).toBe(false);
        if ("type" in queue) return;
        expect(zulipSchema.receive_mode.choices?.map(choice => choice.value)).toEqual([
            "event_queue",
            "manual",
        ]);
        expect("enabled" in queue).toBe(false);
        for (const field of [
            queue.event_types,
            queue.all_public_streams,
            queue.retry_initial_delay_ms,
            queue.retry_max_delay_ms,
        ]) {
            expect(field.ui?.visibleWhen).toEqual({
                path: "receive_mode",
                oneOf: ["event_queue"],
            });
        }
    });
});
