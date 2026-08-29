import { describe, expect, it, vi } from "vitest";
import { MockBot } from "./bot.js";

describe("MockBot 生命周期", () => {
    it("停止会取消尚未完成的启动，不再发出过期 ready", async () => {
        vi.useFakeTimers();
        const bot = new MockBot({ account_id: "bot", latency: 100 });
        const ready = vi.fn();
        bot.on("ready", ready);

        const starting = bot.start();
        await bot.stop();
        await vi.advanceTimersByTimeAsync(100);
        await starting;

        expect(ready).not.toHaveBeenCalled();
        expect(bot.isActive()).toBe(false);
        vi.useRealTimers();
    });

    it("显式零延迟生效，clearData 真的清空而不是恢复默认数据", async () => {
        const bot = new MockBot({ account_id: "bot", latency: 0 });
        await bot.start();
        bot.clearData();
        expect(await bot.getFriendList()).toEqual([]);
        expect(await bot.getGroupList()).toEqual([]);
    });
});
