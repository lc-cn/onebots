import { nextTick, ref, watch, type Ref } from "vue";
import type { ControlChatMessage } from "@onebots/core/control";
import type { AccountControlConversationItem } from "./account-control-list.js";

/** 聊天区只在用户接近底部时跟随新消息；翻阅旧记录时保持原位置。 */
export function useAccountChatViewport(
    messages: Ref<ControlChatMessage[]>,
    selected: Ref<AccountControlConversationItem | undefined>,
    loadHistory: (older?: boolean) => Promise<"reset" | void>,
) {
    const chatViewport = ref<HTMLElement>();
    const loadingOlder = ref<{ selection: number; request: number }>();
    const showJumpLatest = ref(false);
    let selection = 0;
    let olderRequest = 0;

    async function loadOlder() {
        const viewport = chatViewport.value;
        const currentSelection = selection;
        if (loadingOlder.value?.selection === currentSelection) return;
        const request = ++olderRequest;
        const height = viewport?.scrollHeight ?? 0;
        const top = viewport?.scrollTop ?? 0;
        loadingOlder.value = { selection: currentSelection, request };
        try {
            const outcome = await loadHistory(true);
            if (outcome === "reset") {
                await nextTick();
                if (viewport && chatViewport.value === viewport && selection === currentSelection) {
                    viewport.scrollTop = viewport.scrollHeight;
                    showJumpLatest.value = false;
                }
                return;
            }
            await nextTick();
            if (viewport && chatViewport.value === viewport && selection === currentSelection)
                viewport.scrollTop = viewport.scrollHeight - height + top;
        } finally {
            if (loadingOlder.value?.request === request) loadingOlder.value = undefined;
        }
    }

    watch(messages, async (next, previous) => {
        const viewport = chatViewport.value;
        const currentSelection = selection;
        if (!viewport) return;
        const isLoadingOlder = loadingOlder.value?.selection === currentSelection;
        const follow = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96;
        const hasNewMessage = Boolean(
            next.length &&
            (!previous.length || next[next.length - 1].id > previous[previous.length - 1].id),
        );
        if (hasNewMessage && (isLoadingOlder || !follow)) showJumpLatest.value = true;
        if (isLoadingOlder) return;
        await nextTick();
        if (follow && chatViewport.value === viewport && selection === currentSelection)
            viewport.scrollTop = viewport.scrollHeight;
    });

    function onHistoryScroll() {
        const viewport = chatViewport.value;
        if (viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96)
            showJumpLatest.value = false;
    }

    function jumpLatest() {
        const viewport = chatViewport.value;
        if (!viewport) return;
        const reducedMotion =
            typeof matchMedia === "function" &&
            matchMedia("(prefers-reduced-motion: reduce)").matches;
        viewport.scrollTo({
            top: viewport.scrollHeight,
            behavior: reducedMotion ? "auto" : "smooth",
        });
        // 平滑滚动可能被打断；真正到达底部后才由滚动状态收起提示。
        onHistoryScroll();
    }

    watch(
        selected,
        async () => {
            const currentSelection = ++selection;
            showJumpLatest.value = false;
            await nextTick();
            const viewport = chatViewport.value;
            if (viewport && selection === currentSelection)
                viewport.scrollTop = viewport.scrollHeight;
        },
        { flush: "sync" },
    );

    return { chatViewport, showJumpLatest, loadOlder, onHistoryScroll, jumpLatest };
}
