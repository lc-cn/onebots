import { ref, type Ref } from "vue";
import type { ControlChatMessage, ControlClient } from "@onebots/core/control";
import {
    accountControlSceneType,
    type AccountControlConversationItem,
} from "./account-control-list.js";

interface HistoryDependencies {
    client: Pick<ControlClient, "chatHistory">;
    platform: () => string;
    accountId: () => string;
    selected: Ref<AccountControlConversationItem | undefined>;
    online: Ref<boolean>;
    revision: () => number;
    disposed: () => boolean;
    onRevisionChange?: () => void;
}

/** 会话切换使在途历史失效；刷新、向前分页和错误重试共享同一边界。 */
export function useAccountHistory(deps: HistoryDependencies) {
    const messages = ref<ControlChatMessage[]>([]);
    const loading = ref(false);
    const error = ref("");
    const retryOlder = ref(false);
    const hasMore = ref(true);
    let requestRevision = 0;
    let historyRevision: string | undefined;

    function reset() {
        requestRevision++;
        loading.value = false;
        messages.value = [];
        hasMore.value = true;
        error.value = "";
        retryOlder.value = false;
        historyRevision = undefined;
    }

    async function load(older = false, revision = deps.revision()): Promise<"reset" | void> {
        const item = deps.selected.value;
        if (!item || !deps.online.value || loading.value) return;
        loading.value = true;
        const request = ++requestRevision;
        let reloadLatest = false;
        try {
            const result = await deps.client.chatHistory({
                platform: deps.platform(),
                accountId: deps.accountId(),
                sceneType: item.sceneType ?? accountControlSceneType(item.kind),
                sceneId: item.id,
                ...(item.kind === "channel" && item.parentId ? { guildId: item.parentId } : {}),
                ...(older && messages.value.length ? { before: messages.value[0].id } : {}),
            });
            if (deps.disposed() || revision !== deps.revision() || request !== requestRevision)
                return;
            error.value = "";
            retryOlder.value = false;
            const revisionChanged =
                historyRevision !== undefined && historyRevision !== result.revision;
            historyRevision = result.revision;
            if (revisionChanged) {
                messages.value = [];
                hasMore.value = true;
                deps.onRevisionChange?.();
                if (older) {
                    // 旧分页游标属于已被清理的历史，重新读取最新页。
                    reloadLatest = true;
                    return "reset";
                }
            }
            const completePage = result.messages.length < 50;
            if (!older && completePage) {
                // 最新页不足 50 条时已覆盖服务器的全部历史；不能合并本地旧条目，
                // 否则保留期清理或手动清空后仍会显示已删除消息。
                hasMore.value = false;
                messages.value = [...result.messages].sort((left, right) => left.id - right.id);
                return;
            }
            if (older || !messages.value.length) hasMore.value = !completePage;
            const oldestFreshId = Math.min(...result.messages.map(message => message.id));
            const joined = older
                ? [...result.messages, ...messages.value]
                : [
                      ...messages.value.filter(message => message.id < oldestFreshId),
                      ...result.messages,
                  ];
            messages.value = [
                ...new Map(joined.map(message => [message.id, message])).values(),
            ].sort((left, right) => left.id - right.id);
        } catch {
            if (!deps.disposed() && revision === deps.revision() && request === requestRevision) {
                error.value = "聊天记录读取失败，请重试。";
                retryOlder.value = older;
            }
        } finally {
            if (request === requestRevision) loading.value = false;
            if (
                reloadLatest &&
                !deps.disposed() &&
                revision === deps.revision() &&
                request === requestRevision
            )
                void load(false, revision);
        }
    }

    return { messages, loading, error, retryOlder, hasMore, load, reset };
}
