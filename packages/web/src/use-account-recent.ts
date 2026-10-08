import { ref, type Ref } from "vue";
import { accountControlErrorMessage } from "./account-control-error.js";
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
    let olderPagesLoaded = false;

    function reset() {
        listRevision++;
        recent.value = emptyAccountControlList();
        hasMore.value = false;
        olderLoading.value = false;
        olderError.value = "";
        loadedAt = 0;
        olderPagesLoaded = false;
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
            const fresh = result.conversations.map(recentAccountControlItem);
            if (olderPagesLoaded && result.hasMore) {
                // 保留已翻阅的旧页，同时让新近活跃的会话进入列表顶部。
                const byKey = new Map(
                    recent.value.items.map(item => [accountControlItemKey(item), item]),
                );
                for (const item of fresh) byKey.set(accountControlItemKey(item), item);
                recent.value.items = [...byKey.values()].sort(
                    (left, right) => (right.latestId ?? 0) - (left.latestId ?? 0),
                );
            } else {
                recent.value.items = fresh;
                olderPagesLoaded = false;
            }
            recent.value.loaded = true;
            if (!olderPagesLoaded) hasMore.value = result.hasMore;
            olderError.value = "";
            loadedAt = Date.now();
        } catch (error) {
            if (
                !deps.disposed() &&
                revision === deps.revision() &&
                currentListRevision === listRevision
            )
                recent.value.error = accountControlErrorMessage(
                    error,
                    "最近会话读取失败，请重试。",
                );
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
            olderPagesLoaded = true;
            hasMore.value = result.hasMore;
        } catch (error) {
            if (
                !deps.disposed() &&
                revision === deps.revision() &&
                currentListRevision === listRevision
            )
                olderError.value = accountControlErrorMessage(error, "更早会话读取失败，请重试。");
        } finally {
            if (revision === deps.revision() && currentListRevision === listRevision)
                olderLoading.value = false;
        }
    }

    function shouldRefresh(): boolean {
        return deps.online.value && !recent.value.error && Date.now() - loadedAt >= 15_000;
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
