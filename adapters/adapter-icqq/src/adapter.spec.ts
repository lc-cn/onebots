import { describe, expect, it, vi } from "vitest";
import { ICQQAdapter } from "./adapter.js";
import { projectICQQFriendChange } from "./events.js";

describe("ICQQ 账号统一 ID", () => {
    it("将配置中的数字 QQ 号恢复为 number 后投影 CommonEvent.bot_id", () => {
        const adapter = Object.create(ICQQAdapter.prototype) as ICQQAdapter;
        const createId = vi.fn((value: string | number) => ({
            string: String(value),
            number: typeof value === "number" ? value : 99_000_000_001,
            source: value,
        }));
        Object.defineProperty(adapter, "createId", { value: createId });

        const context = adapter["projectionContext"]("12345678");
        const event = projectICQQFriendChange(
            {
                raw_event: {},
                user_id: 10001,
                nickname: "Alice",
                change_type: "increase",
                time: 1_700_000_000,
            },
            context,
        );

        expect(createId).toHaveBeenCalledWith(12345678);
        expect(context.botId).toEqual({
            string: "12345678",
            number: 12345678,
            source: 12345678,
        });
        expect(event.bot_id).toBe(context.botId);
    });
});
