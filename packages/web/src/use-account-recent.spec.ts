import { ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlChatConversation, ControlClient } from "@onebots/core/control";
import { useAccountRecent } from "./use-account-recent.js";

const conversation = (id: number): ControlChatConversation => ({
    sceneType: "private",
    sceneId: `friend-${id}`,
    latest: {
        id,
        platform: "mock",
        accountId: "bot",
        sceneType: "private",
        sceneId: `friend-${id}`,
        senderId: `friend-${id}`,
        senderName: `好友 ${id}`,
        direction: "inbound",
        text: `消息 ${id}`,
        time: id,
    },
});

afterEach(() => vi.restoreAllMocks());

describe("最近会话刷新", () => {
    it("翻阅旧页后继续自动更新顶部，不丢掉已加载的旧会话与分页游标", async () => {
        let now = 1_000;
        vi.spyOn(Date, "now").mockImplementation(() => now);
        let latest = Array.from({ length: 50 }, (_, index) => conversation(100 - index));
        const chatConversations = vi.fn(
            async (_platform: string, _accountId: string, before?: number) =>
                before
                    ? {
                          conversations: Array.from({ length: 10 }, (_, index) =>
                              conversation(50 - index),
                          ),
                          hasMore: true,
                      }
                    : { conversations: latest, hasMore: true },
        );
        const recent = useAccountRecent({
            client: { chatConversations } as unknown as Pick<ControlClient, "chatConversations">,
            platform: () => "mock",
            accountId: () => "bot",
            online: ref(true),
            revision: () => 1,
            disposed: () => false,
        });

        await recent.load();
        await recent.loadOlder();
        expect(recent.recent.value.items.at(-1)?.id).toBe("friend-41");
        now += 15_000;
        expect(recent.shouldRefresh()).toBe(true);
        latest = [conversation(101), ...latest.slice(0, 49)];
        await recent.load(true);

        expect(recent.recent.value.items[0].id).toBe("friend-101");
        expect(recent.recent.value.items.at(-1)?.id).toBe("friend-41");
        expect(new Set(recent.recent.value.items.map(item => item.id)).size).toBe(61);
        expect(recent.hasMore.value).toBe(true);
        await recent.loadOlder();
        expect(chatConversations).toHaveBeenLastCalledWith("mock", "bot", 41);
    });

    it("服务端最近页已完整覆盖历史时丢弃本地过期旧页", async () => {
        let latest = Array.from({ length: 50 }, (_, index) => conversation(100 - index));
        const chatConversations = vi.fn(
            async (_platform: string, _accountId: string, before?: number) =>
                before
                    ? { conversations: [conversation(50)], hasMore: false }
                    : { conversations: latest, hasMore: latest.length === 50 },
        );
        const recent = useAccountRecent({
            client: { chatConversations } as unknown as Pick<ControlClient, "chatConversations">,
            platform: () => "mock",
            accountId: () => "bot",
            online: ref(true),
            revision: () => 1,
            disposed: () => false,
        });
        await recent.load();
        await recent.loadOlder();
        latest = [conversation(101)];
        await recent.load(true);

        expect(recent.recent.value.items.map(item => item.id)).toEqual(["friend-101"]);
        expect(recent.hasMore.value).toBe(false);
    });
});
