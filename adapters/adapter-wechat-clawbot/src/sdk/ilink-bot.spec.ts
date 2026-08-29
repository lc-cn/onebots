import { afterEach, describe, expect, it, vi } from "vitest";
import { IlinkBot } from "./ilink-bot.js";

afterEach(() => vi.unstubAllGlobals());

describe("IlinkBot 接收与轮询生命周期", () => {
    it("ingest 走统一消息管线并记住 context_token", async () => {
        const bot = new IlinkBot({
            session: {
                token: "token",
                accountId: "bot",
                baseUrl: "https://example.test",
                cdnBaseUrl: "https://cdn.example.test",
                contextTokens: {},
            },
        });
        const listener = vi.fn();
        bot.on("message", listener);
        const event = await bot.ingest({
            message_id: 7,
            from_user_id: "peer",
            context_token: "ctx",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
        });
        expect(event.text).toBe("hello");
        expect(listener).toHaveBeenCalledWith(event);
        expect(await bot.getLatestContextToken("peer")).toBe("ctx");
    });

    it("监听器异常不会中断 ingest", async () => {
        const bot = new IlinkBot();
        const errors = vi.fn();
        bot.on("message", () => {
            throw new Error("handler failed");
        });
        bot.onText(/hello/, async () => {
            throw new Error("matcher failed");
        });
        bot.on("listener_error", errors);

        await expect(
            bot.ingest({
                message_id: 8,
                from_user_id: "peer",
                item_list: [{ type: 1, text_item: { text: "hello" } }],
            }),
        ).resolves.toMatchObject({ id: 8 });
        expect(errors).toHaveBeenCalledTimes(2);
    });

    it("ingest 拒绝无法定位或无法回复的畸形事件", async () => {
        const bot = new IlinkBot();
        await expect(bot.ingest(null)).rejects.toMatchObject({ code: "INVALID_EVENT" });
        await expect(bot.ingest({ message_id: 1 })).rejects.toThrow("from_user_id");
        await expect(bot.ingest({ from_user_id: "peer" })).rejects.toThrow(
            "message_id、seq 或 client_id",
        );
        await expect(
            bot.ingest({ from_user_id: "peer", client_id: "client", item_list: {} }),
        ).rejects.toThrow("item_list 必须是数组");
    });

    it("使用 client_id 定位无数值 ID 的宿主事件", async () => {
        const bot = new IlinkBot();
        const event = await bot.ingest({
            client_id: "client-message",
            from_user_id: "peer",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
        });
        expect(event.id).toBe("client-message");
    });

    it("stopPolling 立即中止旧长轮询并发送停止通知", async () => {
        const calls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL, init?: RequestInit) => {
                const url = String(input);
                calls.push(url);
                if (url.endsWith("getupdates")) {
                    return new Promise<Response>((_resolve, reject) => {
                        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
                            once: true,
                        });
                    });
                }
                return new Response("{}", { status: 200 });
            }),
        );
        const bot = new IlinkBot({
            session: {
                token: "token",
                accountId: "bot",
                baseUrl: "https://example.test",
                cdnBaseUrl: "https://cdn.example.test",
                contextTokens: {},
            },
        });

        await bot.startPolling();
        await bot.stopPolling();

        expect(calls.some(url => url.endsWith("notifystart"))).toBe(true);
        expect(calls.some(url => url.endsWith("getupdates"))).toBe(true);
        expect(calls.some(url => url.endsWith("notifystop"))).toBe(true);
    });
});
