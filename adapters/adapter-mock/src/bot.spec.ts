import { describe, expect, it, vi } from "vitest";
import { MockBot } from "./bot.js";
import type { MockIncomingMessage } from "./types.js";

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

    it("等待生命周期监听器，并在 ready 失败后恢复为未运行状态", async () => {
        const bot = new MockBot({ account_id: "bot", latency: 0 });
        bot.on("ready", async () => {
            await Promise.resolve();
            throw new Error("ready failed");
        });

        await expect(bot.start()).rejects.toThrow("ready failed");
        expect(bot.isActive()).toBe(false);
    });

    it("显式零延迟生效，clearData 真的清空而不是恢复默认数据", async () => {
        const bot = new MockBot({ account_id: "bot", latency: 0 });
        await bot.start();
        bot.clearData();
        expect(await bot.getFriendList()).toEqual([]);
        expect(await bot.getGroupList()).toEqual([]);
    });

    it("统一 ingest 入口并严格区分入站与出站消息", async () => {
        const now = vi.fn(() => 1_700_000_000_000);
        const bot = new MockBot(
            { account_id: "bot", latency: 0 },
            { now, sleep: () => Promise.resolve() },
        );
        const incoming: MockIncomingMessage = {
            type: "private",
            message_id: "incoming-1",
            user_id: "10001",
            content: "收到",
            time: 1_700_000_000,
        };

        await bot.ingest({ type: "message", data: incoming });
        const sent = await bot.sendMessage("10001", "发出");

        expect(bot.getReceivedMessages()).toEqual([
            expect.objectContaining({ message_id: "incoming-1", content: "收到" }),
        ]);
        expect(bot.getSentMessages()).toEqual([
            expect.objectContaining({ message_id: sent.message_id, content: "发出" }),
        ]);
        expect(sent.message_id).toBe("mock_msg_1_1700000000000");
    });

    it("拒绝结构无效的事件和未知自动事件类型", async () => {
        const bot = new MockBot({ account_id: "bot", latency: 0 });

        await expect(bot.ingest({ type: "message", data: {} } as never)).rejects.toThrowError(
            expect.objectContaining({ code: "MOCK_INVALID_EVENT" }),
        );
        expect(
            () =>
                new MockBot({
                    account_id: "bot",
                    auto_event_types: ["unknown" as never],
                }),
        ).toThrowError(expect.objectContaining({ code: "MOCK_INVALID_CONFIG" }));
        expect(
            () =>
                new MockBot({
                    account_id: "bot",
                    friends: [{ user_id: "", nickname: "无效" }],
                }),
        ).toThrowError(expect.objectContaining({ code: "MOCK_INVALID_CONFIG" }));
    });

    it("等待全部异步监听器并在投递完成后传播失败", async () => {
        const bot = new MockBot({ account_id: "bot", latency: 0 });
        const completed: string[] = [];
        bot.on("heartbeat", async () => {
            await Promise.resolve();
            completed.push("first");
            throw new Error("protocol failed");
        });
        bot.on("heartbeat", async () => {
            await Promise.resolve();
            completed.push("second");
        });

        await expect(bot.ingest({ type: "heartbeat", data: { time: 1 } })).rejects.toThrow(
            "protocol failed",
        );
        expect(completed).toEqual(["first", "second"]);
    });

    it("返回存储快照，外部修改不会污染内部状态", async () => {
        const bot = new MockBot({ account_id: "bot", latency: 0 });
        const sent = await bot.sendMessage("10001", "原文");
        const first = await bot.getMessage(sent.message_id);
        if (!first) throw new Error("测试消息不存在");
        first.content = "被修改";

        await expect(bot.getMessage(sent.message_id)).resolves.toMatchObject({ content: "原文" });
    });
});
