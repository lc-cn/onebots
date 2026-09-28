import { nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlAccountItem, ControlChatMessage } from "@onebots/core/control";
import type { AccountControlConversationItem } from "./account-control-list.js";
import { useAccountChatViewport } from "./use-account-chat-viewport.js";

const message = (id: number): ControlChatMessage => ({
    id,
    platform: "mock",
    accountId: "bot",
    sceneType: "private",
    sceneId: "friend",
    senderId: "friend",
    senderName: "好友",
    direction: "inbound",
    text: `消息 ${id}`,
    time: id,
});
afterEach(() => vi.unstubAllGlobals());

describe("聊天区滚动", () => {
    it("新消息跳转被打断时保留提示，到达底部后才收起", async () => {
        const messages = ref<ControlChatMessage[]>([]);
        const selected = ref<ControlAccountItem>();
        const viewport = useAccountChatViewport(messages, selected, async () => {});
        const scrollTo = vi.fn();
        const element = { scrollHeight: 800, scrollTop: 100, clientHeight: 300, scrollTo };
        viewport.chatViewport.value = element as unknown as HTMLElement;
        vi.stubGlobal("matchMedia", () => ({ matches: false }));

        messages.value = [message(1)];
        await nextTick();
        expect(viewport.showJumpLatest.value).toBe(true);
        viewport.jumpLatest();
        expect(scrollTo).toHaveBeenCalledWith({ top: 800, behavior: "smooth" });
        expect(viewport.showJumpLatest.value).toBe(true);

        element.scrollTop = 500;
        viewport.onHistoryScroll();
        expect(viewport.showJumpLatest.value).toBe(false);
    });

    it("减少动态效果时立即跳转到最新消息", async () => {
        const messages = ref<ControlChatMessage[]>([]);
        const selected = ref<ControlAccountItem>();
        const viewport = useAccountChatViewport(messages, selected, async () => {});
        const element = {
            scrollHeight: 800,
            scrollTop: 100,
            clientHeight: 300,
            scrollTo: vi.fn(({ top }: { top: number }) => {
                element.scrollTop = top;
            }),
        };
        viewport.chatViewport.value = element as unknown as HTMLElement;
        vi.stubGlobal("matchMedia", () => ({ matches: true }));

        messages.value = [message(1)];
        await nextTick();
        viewport.jumpLatest();
        expect(element.scrollTo).toHaveBeenCalledWith({ top: 800, behavior: "auto" });
        expect(viewport.showJumpLatest.value).toBe(false);
    });

    it("翻阅旧消息时提示新消息，回到底部后清除提示", async () => {
        const messages = ref<ControlChatMessage[]>([]);
        const selected = ref<ControlAccountItem>();
        const viewport = useAccountChatViewport(messages, selected, async () => {});
        viewport.chatViewport.value = {
            scrollHeight: 800,
            scrollTop: 100,
            clientHeight: 300,
        } as HTMLElement;

        messages.value = [message(1)];
        await nextTick();
        expect(viewport.showJumpLatest.value).toBe(true);
        expect(viewport.chatViewport.value.scrollTop).toBe(100);

        viewport.chatViewport.value.scrollTop = 500;
        viewport.onHistoryScroll();
        expect(viewport.showJumpLatest.value).toBe(false);
    });

    it("加载更早消息后维持原来正在阅读的位置", async () => {
        const messages = ref<ControlChatMessage[]>([message(2)]);
        const selected = ref<ControlAccountItem>();
        const element = { scrollHeight: 800, scrollTop: 120, clientHeight: 300 };
        const viewport = useAccountChatViewport(messages, selected, async older => {
            expect(older).toBe(true);
            element.scrollHeight = 1000;
            messages.value = [message(1), ...messages.value];
        });
        viewport.chatViewport.value = element as HTMLElement;

        await viewport.loadOlder();
        expect(element.scrollTop).toBe(320);
        expect(viewport.showJumpLatest.value).toBe(false);
    });

    it("旧页因历史清理失效时不再应用分页滚动补偿", async () => {
        const messages = ref<ControlChatMessage[]>([message(2)]);
        const selected = ref<ControlAccountItem>();
        const element = { scrollHeight: 800, scrollTop: 120, clientHeight: 300 };
        const viewport = useAccountChatViewport(messages, selected, async () => {
            messages.value = [];
            element.scrollHeight = 0;
            element.scrollTop = 0;
            return "reset";
        });
        viewport.chatViewport.value = element as HTMLElement;

        await viewport.loadOlder();
        expect(element.scrollTop).toBe(0);
    });

    it("旧页清理后最新消息先返回时，回到新历史底部而不留下误导的新消息提示", async () => {
        const messages = ref<ControlChatMessage[]>([message(50)]);
        const selected = ref<AccountControlConversationItem>({
            kind: "friend",
            id: "friend",
            name: "好友",
        });
        const element = { scrollHeight: 800, scrollTop: 120, clientHeight: 300 };
        const viewport = useAccountChatViewport(messages, selected, async () => {
            messages.value = [];
            element.scrollHeight = 600;
            element.scrollTop = 0;
            await nextTick();
            messages.value = [message(101)];
            await nextTick();
            return "reset";
        });
        viewport.chatViewport.value = element as HTMLElement;

        await viewport.loadOlder();
        expect(element.scrollTop).toBe(600);
        expect(viewport.showJumpLatest.value).toBe(false);
    });

    it("相同 ID 的一对一和多人直聊切换时重置阅读位置与新消息提示", async () => {
        const messages = ref<ControlChatMessage[]>([]);
        const selected = ref<AccountControlConversationItem>({
            kind: "friend",
            id: "same-id",
            name: "好友",
            sceneType: "private",
        });
        const element = { scrollHeight: 800, scrollTop: 100, clientHeight: 300 };
        const viewport = useAccountChatViewport(messages, selected, async () => {});
        viewport.chatViewport.value = element as HTMLElement;
        messages.value = [message(1)];
        await nextTick();
        expect(viewport.showJumpLatest.value).toBe(true);

        selected.value = { ...selected.value, sceneType: "direct" };
        await nextTick();
        await nextTick();
        expect(viewport.showJumpLatest.value).toBe(false);
        expect(element.scrollTop).toBe(800);
    });

    it("更早消息请求未结束时切换会话，不把旧会话的滚动补偿作用于新会话", async () => {
        let finish!: () => void;
        const older = new Promise<void>(resolve => {
            finish = resolve;
        });
        const messages = ref<ControlChatMessage[]>([message(2)]);
        const selected = ref<AccountControlConversationItem>({
            kind: "friend",
            id: "same-id",
            name: "好友",
            sceneType: "private",
        });
        const element = { scrollHeight: 800, scrollTop: 120, clientHeight: 300 };
        const viewport = useAccountChatViewport(messages, selected, () => older);
        viewport.chatViewport.value = element as HTMLElement;
        const pending = viewport.loadOlder();
        selected.value = { ...selected.value, sceneType: "direct" };
        await nextTick();
        await nextTick();
        element.scrollHeight = 1100;
        element.scrollTop = 200;
        finish();
        await pending;
        expect(element.scrollTop).toBe(200);
    });

    it("旧会话分页仍在等待时，新会话的新消息提示不被压制", async () => {
        let finishOlder!: () => void;
        const older = new Promise<void>(resolve => {
            finishOlder = resolve;
        });
        const messages = ref<ControlChatMessage[]>([message(2)]);
        const selected = ref<AccountControlConversationItem>({
            kind: "friend",
            id: "friend-a",
            name: "好友 A",
        });
        const element = { scrollHeight: 800, scrollTop: 120, clientHeight: 300 };
        const viewport = useAccountChatViewport(messages, selected, () => older);
        viewport.chatViewport.value = element as HTMLElement;
        const pending = viewport.loadOlder();

        selected.value = { kind: "friend", id: "friend-b", name: "好友 B" };
        messages.value = [message(10)];
        await nextTick();
        await nextTick();
        element.scrollTop = 100;
        messages.value = [message(10), message(11)];
        await nextTick();
        expect(viewport.showJumpLatest.value).toBe(true);

        finishOlder();
        await pending;
        expect(element.scrollTop).toBe(100);
    });

    it("当前会话加载旧消息期间收到新消息，仍提示用户查看最新消息", async () => {
        let finishOlder!: () => void;
        const older = new Promise<void>(resolve => {
            finishOlder = resolve;
        });
        const messages = ref<ControlChatMessage[]>([message(2)]);
        const selected = ref<AccountControlConversationItem>({
            kind: "friend",
            id: "friend-a",
            name: "好友 A",
        });
        const element = { scrollHeight: 800, scrollTop: 500, clientHeight: 300 };
        const viewport = useAccountChatViewport(messages, selected, () => older);
        viewport.chatViewport.value = element as HTMLElement;
        const pending = viewport.loadOlder();

        messages.value = [message(2), message(3)];
        await nextTick();
        expect(viewport.showJumpLatest.value).toBe(true);
        finishOlder();
        await pending;
    });

    it("离开又重新打开同一会话后，旧分页不能补偿新一次的阅读位置", async () => {
        let finishOlder!: () => void;
        const older = new Promise<void>(resolve => {
            finishOlder = resolve;
        });
        const messages = ref<ControlChatMessage[]>([message(2)]);
        const selected = ref<AccountControlConversationItem | undefined>({
            kind: "friend",
            id: "friend-a",
            name: "好友 A",
        });
        const element = { scrollHeight: 800, scrollTop: 120, clientHeight: 300 };
        const viewport = useAccountChatViewport(messages, selected, () => older);
        viewport.chatViewport.value = element as HTMLElement;
        const pending = viewport.loadOlder();

        selected.value = undefined;
        selected.value = { kind: "friend", id: "friend-a", name: "好友 A" };
        await nextTick();
        element.scrollHeight = 1100;
        element.scrollTop = 200;
        finishOlder();
        await pending;
        expect(element.scrollTop).toBe(200);
    });
});
