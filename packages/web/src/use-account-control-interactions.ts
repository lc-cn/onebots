import { nextTick, ref, type Ref } from "vue";
import type { AccountControlConversationItem } from "./account-control-list.js";
import type AccountControlConversationHead from "./components/AccountControlConversationHead.vue";

interface AccountControlInteractionDependencies {
    selected: Ref<AccountControlConversationItem | undefined>;
    canChat: Ref<boolean>;
    text: Ref<string>;
    sendBusy: Ref<boolean>;
    pendingSendId: Ref<string>;
    sendCapabilityLoading: Ref<boolean>;
    choose: (item: AccountControlConversationItem) => Promise<void>;
    clearSelection: () => void;
    openManual: () => void;
    loadFriendList: () => Promise<void>;
    sendMessage: () => Promise<void>;
    querySend: () => Promise<void>;
}

/** 控制页的焦点交接集中处理，异步完成后不移动已切换会话的焦点。 */
export function useAccountControlInteractions(deps: AccountControlInteractionDependencies) {
    const conversationHead = ref<InstanceType<typeof AccountControlConversationHead>>();
    const contactsPanel = ref<HTMLElement>();
    const contactSearchInput = ref<HTMLInputElement>();
    const composerInput = ref<{ focus: () => void }>();
    const sendState = ref<HTMLElement>();

    async function focusConversationBack() {
        await nextTick();
        if (deps.selected.value && matchMedia("(max-width: 700px)").matches)
            conversationHead.value?.focusBack();
    }

    async function openItem(item: AccountControlConversationItem) {
        void deps.choose(item);
        await focusConversationBack();
    }

    async function returnToList() {
        deps.clearSelection();
        await nextTick();
        // 手机返回列表时不聚焦搜索框，避免软键盘立刻遮住联系人。
        if (matchMedia("(max-width: 700px)").matches) contactsPanel.value?.focus();
        else contactSearchInput.value?.focus();
    }

    async function openManualItem() {
        deps.openManual();
        await focusConversationBack();
    }

    async function retrySendCapability() {
        if (deps.sendCapabilityLoading.value) return;
        const item = deps.selected.value;
        await deps.loadFriendList();
        if (item !== deps.selected.value || !deps.canChat.value) return;
        await nextTick();
        composerInput.value?.focus();
    }

    async function submitMessage() {
        if (
            !deps.canChat.value ||
            !deps.text.value.trim() ||
            deps.sendBusy.value ||
            deps.pendingSendId.value
        )
            return;
        const item = deps.selected.value;
        await deps.sendMessage();
        if (item !== deps.selected.value) return;
        await nextTick();
        if (deps.pendingSendId.value)
            sendState.value?.querySelector<HTMLButtonElement>("[data-query-send]")?.focus();
        else if (deps.canChat.value) composerInput.value?.focus();
    }

    async function querySendAndFocus() {
        if (deps.sendBusy.value) return;
        const item = deps.selected.value;
        await deps.querySend();
        if (item !== deps.selected.value || deps.pendingSendId.value || !deps.canChat.value) return;
        await nextTick();
        composerInput.value?.focus();
    }

    return {
        conversationHead,
        contactsPanel,
        contactSearchInput,
        composerInput,
        sendState,
        openItem,
        returnToList,
        openManualItem,
        retrySendCapability,
        submitMessage,
        querySendAndFocus,
    };
}
