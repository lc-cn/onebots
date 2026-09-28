import { ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountControlConversationItem } from "./account-control-list.js";
import { useAccountControlInteractions } from "./use-account-control-interactions.js";

const direct: AccountControlConversationItem = {
    kind: "friend",
    id: "room-1",
    name: "多人直聊",
    sceneType: "direct",
};
afterEach(() => vi.unstubAllGlobals());

describe("账号控制异步焦点交接", () => {
    it.each([
        { mobile: true, target: "list" },
        { mobile: false, target: "search" },
    ])("返回会话列表时按视口聚焦 $target", async ({ mobile, target }) => {
        vi.stubGlobal("matchMedia", () => ({ matches: mobile }));
        const selected = ref<AccountControlConversationItem | undefined>(direct);
        const interactions = useAccountControlInteractions({
            selected,
            canChat: ref(true),
            text: ref(""),
            sendBusy: ref(false),
            pendingSendId: ref(""),
            sendCapabilityLoading: ref(false),
            choose: vi.fn(),
            clearSelection: () => {
                selected.value = undefined;
            },
            openManual: vi.fn(),
            loadFriendList: vi.fn(),
            sendMessage: vi.fn(),
            querySend: vi.fn(),
        });
        const focusList = vi.fn();
        const focusSearch = vi.fn();
        interactions.contactsPanel.value = { focus: focusList } as unknown as HTMLElement;
        interactions.contactSearchInput.value = {
            focus: focusSearch,
        } as unknown as HTMLInputElement;

        await interactions.returnToList();

        expect(focusList).toHaveBeenCalledTimes(mobile ? 1 : 0);
        expect(focusSearch).toHaveBeenCalledTimes(mobile ? 0 : 1);
    });

    it("未知发送聚焦原操作查询，查询完成后回到输入框", async () => {
        const selected = ref<AccountControlConversationItem>(direct);
        const pendingSendId = ref("");
        const queryFocus = vi.fn();
        const inputFocus = vi.fn();
        const interactions = useAccountControlInteractions({
            selected,
            canChat: ref(true),
            text: ref("消息"),
            sendBusy: ref(false),
            pendingSendId,
            sendCapabilityLoading: ref(false),
            choose: vi.fn(),
            clearSelection: vi.fn(),
            openManual: vi.fn(),
            loadFriendList: vi.fn(),
            sendMessage: async () => {
                pendingSendId.value = "operation-1";
            },
            querySend: async () => {
                pendingSendId.value = "";
            },
        });
        interactions.sendState.value = {
            querySelector: () => ({ focus: queryFocus }),
        } as unknown as HTMLElement;
        interactions.composerInput.value = { focus: inputFocus } as unknown as HTMLTextAreaElement;

        await interactions.submitMessage();
        expect(queryFocus).toHaveBeenCalledOnce();
        expect(inputFocus).not.toHaveBeenCalled();
        await interactions.querySendAndFocus();
        expect(inputFocus).toHaveBeenCalledOnce();
    });

    it("发送期间切换会话，不把旧操作的焦点移到新会话", async () => {
        const selected = ref<AccountControlConversationItem>(direct);
        const pendingSendId = ref("");
        let finish!: () => void;
        const sending = new Promise<void>(resolve => {
            finish = resolve;
        });
        const interactions = useAccountControlInteractions({
            selected,
            canChat: ref(true),
            text: ref("消息"),
            sendBusy: ref(false),
            pendingSendId,
            sendCapabilityLoading: ref(false),
            choose: vi.fn(),
            clearSelection: vi.fn(),
            openManual: vi.fn(),
            loadFriendList: vi.fn(),
            sendMessage: () => sending,
            querySend: vi.fn(),
        });
        const queryFocus = vi.fn();
        const inputFocus = vi.fn();
        interactions.sendState.value = {
            querySelector: () => ({ focus: queryFocus }),
        } as unknown as HTMLElement;
        interactions.composerInput.value = { focus: inputFocus } as unknown as HTMLTextAreaElement;

        const submitted = interactions.submitMessage();
        selected.value = { ...direct, id: "room-2" };
        pendingSendId.value = "operation-1";
        finish();
        await submitted;
        expect(queryFocus).not.toHaveBeenCalled();
        expect(inputFocus).not.toHaveBeenCalled();
    });
});
