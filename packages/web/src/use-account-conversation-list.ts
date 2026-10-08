import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from "vue";

interface AccountConversationListDependencies {
    panel: Ref<HTMLElement | undefined>;
    focusBack: () => void;
    returnToList: () => Promise<void>;
}

/** 会话列表的窄屏浮层与焦点交接统一管理，联系人和手动目标使用同一打开路径。 */
export function useAccountConversationList(deps: AccountConversationListDependencies) {
    const dialog = ref<HTMLDialogElement>();
    const opened = ref(false);
    let mobileQuery: MediaQueryList | undefined;

    function close() {
        if (dialog.value?.open) dialog.value.close();
        opened.value = false;
    }

    function onClose() {
        opened.value = false;
        if (mobileQuery?.matches) deps.focusBack();
    }

    async function open() {
        if (!mobileQuery?.matches) return deps.returnToList();
        if (opened.value) return;
        opened.value = true;
        await nextTick();
        if (!opened.value || !mobileQuery.matches) return;
        dialog.value?.showModal();
        // 聚焦列表而非搜索输入，避免手机软键盘遮住联系人。
        deps.panel.value?.focus();
    }

    async function openTarget(action: () => Promise<void>) {
        if (opened.value) {
            close();
            await nextTick();
        }
        await action();
    }

    onMounted(() => {
        mobileQuery = matchMedia("(max-width: 700px)");
        mobileQuery.addEventListener("change", close);
    });
    onBeforeUnmount(() => {
        mobileQuery?.removeEventListener("change", close);
        close();
    });

    return { dialog, opened, open, close, onClose, openTarget };
}
