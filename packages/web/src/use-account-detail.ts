import { ref } from "vue";
import type {
    ControlAccountExploreResult,
    ControlAccountItem,
    ControlClient,
    ControlSendContext,
} from "@onebots/core/control";
import type { AccountControlConversationItem } from "./account-control-list.js";

interface AccountDetailDependencies {
    client: Pick<ControlClient, "exploreAccount">;
    account: () => string;
    ensureContext: () => Promise<ControlSendContext | undefined>;
    revision: () => number;
    disposed: () => boolean;
    onCapabilities: (result: ControlAccountExploreResult) => void;
}

/** 详情失败可原位重试；会话切换后旧响应不得回写当前详情。 */
export function useAccountDetail(deps: AccountDetailDependencies) {
    const detail = ref<ControlAccountItem>();
    const supported = ref<boolean>();
    const loading = ref(false);
    const error = ref("");
    let requestRevision = 0;

    function reset() {
        requestRevision++;
        detail.value = undefined;
        supported.value = undefined;
        loading.value = false;
        error.value = "";
    }

    async function load(
        item: AccountControlConversationItem,
        expected?: ControlSendContext,
        revision = deps.revision(),
    ) {
        if (deps.disposed() || revision !== deps.revision()) return;
        const request = ++requestRevision;
        const isCurrent = () =>
            !deps.disposed() && revision === deps.revision() && request === requestRevision;
        loading.value = true;
        try {
            const current = expected ?? (await deps.ensureContext());
            if (!isCurrent()) return;
            if (!current) {
                error.value = "网关连接暂不可用，仍可查看已保存的聊天记录。";
                return;
            }
            const result = await deps.client.exploreAccount({
                expected: current,
                account: deps.account(),
                action: "detail",
                kind: item.kind,
                id: item.id,
                ...(item.parentId ? { guildId: item.parentId } : {}),
            });
            if (!isCurrent()) return;
            supported.value = result.supported;
            detail.value = result.supported ? result.items[0] : undefined;
            error.value = "";
            deps.onCapabilities(result);
        } catch {
            if (isCurrent()) error.value = "详情读取失败，请重试；列表信息仍可使用。";
        } finally {
            if (isCurrent()) loading.value = false;
        }
    }

    return { detail, supported, loading, error, load, reset };
}
