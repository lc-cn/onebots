import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatHistoryStore } from "../chat-history-store.js";
import { respondControlChatHistory } from "./chat-history-http.js";

function responseFixture() {
    let status = 0;
    let body: unknown;
    const response = {
        writeHead: vi.fn((code: number) => {
            status = code;
        }),
        end: vi.fn((text: string) => {
            body = JSON.parse(text);
        }),
    } as unknown as ServerResponse;
    return { response, result: () => ({ status, body }) };
}

describe("控制页最近会话接口", () => {
    it("历史接口返回与消息同一快照的修订号", async () => {
        const historyPage = vi.fn().mockReturnValue({ messages: [], revision: "revision-1" });
        const route = "/api/control/accounts/history";
        const fixture = responseFixture();
        await respondControlChatHistory(
            { historyPage } as unknown as ChatHistoryStore,
            {
                method: "GET",
                url: `${route}?platform=mock&accountId=bot&sceneType=private&sceneId=friend`,
                headers: {},
            } as IncomingMessage,
            fixture.response,
            route,
            true,
        );
        expect(fixture.result()).toEqual({
            status: 200,
            body: { messages: [], revision: "revision-1" },
        });
        expect(historyPage).toHaveBeenCalledWith({
            platform: "mock",
            accountId: "bot",
            sceneType: "private",
            sceneId: "friend",
        });
    });

    it("仅允许精确的账号参数，并返回该账号的会话", async () => {
        const conversations = vi.fn().mockReturnValue([{ sceneType: "direct", sceneId: "room" }]);
        const store = { conversations } as unknown as ChatHistoryStore;
        const route = "/api/control/accounts/history/conversations";
        const valid = responseFixture();
        await respondControlChatHistory(
            store,
            {
                method: "GET",
                url: `${route}?platform=mock&accountId=bot`,
                headers: {},
            } as IncomingMessage,
            valid.response,
            route,
            true,
        );
        expect(valid.result()).toEqual({
            status: 200,
            body: { conversations: [{ sceneType: "direct", sceneId: "room" }], hasMore: false },
        });
        expect(conversations).toHaveBeenCalledWith("mock", "bot", undefined);

        const invalid = responseFixture();
        await respondControlChatHistory(
            store,
            {
                method: "GET",
                url: `${route}?platform=mock&accountId=bot&extra=1`,
                headers: {},
            } as IncomingMessage,
            invalid.response,
            route,
            true,
        );
        expect(invalid.result()).toEqual({ status: 400, body: { message: "会话查询无效" } });
        expect(conversations).toHaveBeenCalledOnce();

        const page = responseFixture();
        conversations.mockReturnValue(
            Array.from({ length: 51 }, (_, index) => ({ sceneId: String(index) })),
        );
        await respondControlChatHistory(
            store,
            {
                method: "GET",
                url: `${route}?platform=mock&accountId=bot&before=42`,
                headers: {},
            } as IncomingMessage,
            page.response,
            route,
            true,
        );
        expect(conversations).toHaveBeenCalledWith("mock", "bot", 42);
        expect(page.result()).toMatchObject({ status: 200, body: { hasMore: true } });
        expect((page.result().body as { conversations: unknown[] }).conversations).toHaveLength(50);
    });

    it("远程访问仍须设备会话授权", async () => {
        const conversations = vi.fn();
        const route = "/api/control/accounts/history/conversations";
        const fixture = responseFixture();
        await respondControlChatHistory(
            { conversations } as unknown as ChatHistoryStore,
            {
                method: "GET",
                url: `${route}?platform=mock&accountId=bot`,
                headers: {},
            } as IncomingMessage,
            fixture.response,
            route,
            false,
        );
        expect(fixture.result()).toEqual({ status: 401, body: { message: "控制认证失败" } });
        expect(conversations).not.toHaveBeenCalled();
    });
});
