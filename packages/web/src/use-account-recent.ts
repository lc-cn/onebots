import { ref, type Ref } from "vue";
import type { ControlClient } from "@onebots/core/control";
import {
    accountControlItemKey,
    emptyAccountControlList,
    recentAccountControlItem,
    type AccountControlListState,
} from "./account-control-list.js";

interface RecentDependencies {
    client: Pick<ControlClient, "chatConversations">;
    platform: () => string;
    accountId: () => string;
    online: Ref<boolean>;
    revision: () => number;
    disposed: () => boolean;
}

/** 最近会话独立于平台联系人目录；网关不可用时也不污染其列表状态。 */
export function useAccountRecent(deps: RecentDependencies) {
    const recent = ref<AccountControlListState>(emptyAccountControlList());
    const hasMore = ref(false);
    const olderLoading = ref(false);
    const olderError = ref("");
    let loadedAt = 0;
    let listRevision = 0;

    function reset() {
        listRevision++;
        recent.value = emptyAccountControlList();
        hasMore.value = false;
        olderLoading.value = false;
        olderError.value = "";
        loadedAt = 0;
    }

    /** 历史修订号变化时旧目录及其在途分页都不再可信。 */
    function invalidate() {
        reset();
        void load();
    }

    async function load(force = false) {
        if (
            !deps.online.value ||
            recent.value.loading ||
            olderLoading.value ||
            (recent.value.loaded && !force)
        )
            return;
        const revision = deps.revision();
        const currentListRevision = listRevision;
        recent.value.loading = true;
        recent.value.error = "";
        try {
            const result = await deps.client.chatConversations(deps.platform(), deps.accountId());
            if (
                deps.disposed() ||
                revision !== deps.revision() ||
                currentListRevision !== listRevision
            )
                return;
            recent.value.items = result.conversations.map(recentAccountControlItem);
            recent.value.loaded = true;
            hasMore.value = result.hasMore;
            olderError.value = "";
            loadedAt = Date.now();
        } catch {
            if (
                !deps.disposed() &&
                revision === deps.revision() &&
                currentListRevision === listRevision
            )
                recent.value.error = "最近会话读取失败，请重试。";
        } finally {
            if (revision === deps.revision() && currentListRevision === listRevision)
                recent.value.loading = false;
        }
    }

    async function loadOlder() {
        if (!deps.online.value || recent.value.loading || olderLoading.value || !hasMore.value)
            return;
        const before = recent.value.items.at(-1)?.latestId;
        if (!before) return;
        const revision = deps.revision();
        const currentListRevision = listRevision;
        olderLoading.value = true;
        olderError.value = "";
        try {
            const result = await deps.client.chatConversations(
                deps.platform(),
                deps.accountId(),
                before,
            );
            if (
                deps.disposed() ||
                revision !== deps.revision() ||
                currentListRevision !== listRevision
            )
                return;
            const seen = new Set(recent.value.items.map(accountControlItemKey));
            recent.value.items.push(
                ...result.conversations
                    .map(recentAccountControlItem)
                    .filter(item => !seen.has(accountControlItemKey(item))),
            );
            hasMore.value = result.hasMore;
        } catch {
            if (
                !deps.disposed() &&
                revision === deps.revision() &&
                currentListRevision === listRevision
            )
                olderError.value = "更早会话读取失败，请重试。";
        } finally {
            if (revision === deps.revision() && currentListRevision === listRevision)
                olderLoading.value = false;
        }
    }

    function shouldRefresh(): boolean {
        return (
            deps.online.value &&
            !recent.value.error &&
            recent.value.items.length <= 50 &&
            Date.now() - loadedAt >= 15_000
        );
    }

    return {
        recent,
        hasMore,
        olderLoading,
        olderError,
        load,
        loadOlder,
        reset,
        invalidate,
        shouldRefresh,
    };
}
