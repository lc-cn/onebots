import { ref } from "vue";
import { accountControlErrorMessage } from "./account-control-error.js";
import type {
    ControlAccountExploreResult,
    ControlAccountItem,
    ControlClient,
    ControlSendContext,
} from "@onebots/core/control";

interface AccountMembersDependencies {
    client: Pick<ControlClient, "exploreAccount">;
    account: () => string;
    ensureContext: () => Promise<ControlSendContext | undefined>;
    revision: () => number;
    disposed: () => boolean;
    onCapabilities: (result: ControlAccountExploreResult) => void;
}

/** 成员读取与详情、历史彼此独立，失败只影响成员区。 */
export function useAccountMembers(deps: AccountMembersDependencies) {
    const members = ref<ControlAccountItem[]>([]);
    const loaded = ref(false);
    const supported = ref(true);
    const truncated = ref(false);
    const loading = ref(false);
    const failure = ref("");

    function reset() {
        members.value = [];
        loaded.value = false;
        supported.value = true;
        truncated.value = false;
        loading.value = false;
        failure.value = "";
    }

    async function load(
        item: ControlAccountItem,
        expected?: ControlSendContext,
        revision = deps.revision(),
    ) {
        if (deps.disposed() || revision !== deps.revision()) return;
        if (loading.value) return;
        loading.value = true;
        try {
            const current = expected ?? (await deps.ensureContext());
            if (deps.disposed() || revision !== deps.revision()) return;
            if (!current) throw new Error("网关连接暂不可用");
            const result = await deps.client.exploreAccount({
                expected: current,
                account: deps.account(),
                action: "members",
                kind: item.kind,
                id: item.id,
                ...(item.parentId ? { guildId: item.parentId } : {}),
            });
            if (deps.disposed() || revision !== deps.revision()) return;
            supported.value = result.supported;
            loaded.value = true;
            truncated.value = result.truncated;
            members.value = result.items;
            failure.value = "";
            deps.onCapabilities(result);
        } catch (error) {
            if (!deps.disposed() && revision === deps.revision())
                failure.value = accountControlErrorMessage(error, "成员读取失败，请重试。");
        } finally {
            if (revision === deps.revision()) loading.value = false;
        }
    }

    return { members, loaded, supported, truncated, loading, error: failure, load, reset };
}
