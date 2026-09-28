import { computed, reactive, ref, watch, type Ref } from "vue";
import type {
    ControlClient,
    ControlSendContext,
    ControlSendOperation,
} from "@onebots/core/control";
import type { AccountControlConversationItem } from "./account-control-list.js";
import {
    browserAccountSendStorage,
    readPendingAccountSends,
    writePendingAccountSends,
    type AccountSendOperationStorage,
} from "./account-send-recovery.js";

interface AccountSendDependencies {
    client: Pick<ControlClient, "sendMessage" | "sendOperation">;
    account: () => string;
    selected: Ref<AccountControlConversationItem | undefined>;
    online: Ref<boolean>;
    canChat: Ref<boolean>;
    ensureContext: () => Promise<ControlSendContext | undefined>;
    refreshHistory: () => void;
    operationStorage?: AccountSendOperationStorage;
}

interface PendingSend {
    id: string;
    status?: ControlSendOperation["status"];
    target?: { key: string; text: string; label: string };
    busy: boolean;
    error: string;
}

/** 草稿与幂等发送均按会话隔离；未知结果只阻止原会话重复发送。 */
export function useAccountSend(deps: AccountSendDependencies) {
    const text = ref("");
    const drafts = new Map<string, string>();
    const operationStorage = deps.operationStorage ?? browserAccountSendStorage();
    const pendingByConversation = reactive(
        new Map<string, PendingSend>(
            [...readPendingAccountSends(operationStorage)].map(([key, id]) => [
                key,
                {
                    id,
                    status: "unknown",
                    busy: false,
                    error: "此会话有待确认的发送操作。请先查询结果，不要重复发送。",
                },
            ]),
        ),
    );
    const confirmAbandon = ref(false);
    function conversationKey(item: AccountControlConversationItem): string {
        const base = [deps.account(), item.kind, item.parentId ?? "", item.id];
        // 保持既有待确认操作的本地键；只有独立 direct 会话追加身份。
        return JSON.stringify(item.sceneType === "direct" ? [...base, "direct"] : base);
    }
    const currentKey = computed(() =>
        deps.selected.value ? conversationKey(deps.selected.value) : "",
    );
    const pending = computed(() => pendingByConversation.get(currentKey.value));
    const sendBusy = computed(() => pending.value?.busy ?? false);
    const sendError = computed(() => pending.value?.error ?? "");
    const pendingSendId = computed(() => pending.value?.id ?? "");
    const pendingStatus = computed(() => pending.value?.status);
    const pendingTargetLabel = computed(() => pending.value?.target?.label);

    watch(
        currentKey,
        (next, previous) => {
            if (previous) drafts.set(previous, text.value);
            text.value = next ? (drafts.get(next) ?? "") : "";
            confirmAbandon.value = false;
        },
        { flush: "sync" },
    );
    watch(
        () => deps.account(),
        () => {
            drafts.clear();
            text.value = "";
            confirmAbandon.value = false;
        },
        { flush: "sync" },
    );

    function update(key: string, patch: Partial<PendingSend>) {
        pendingByConversation.set(key, {
            id: "",
            busy: false,
            error: "",
            ...pendingByConversation.get(key),
            ...patch,
        });
        persistPending();
    }

    function clear(key: string) {
        pendingByConversation.delete(key);
        persistPending();
    }

    function persistPending() {
        writePendingAccountSends(
            operationStorage,
            new Map(
                [...pendingByConversation]
                    .filter(([, value]) => Boolean(value.id))
                    .map(([key, value]) => [key, value.id]),
            ),
        );
    }

    function hasPending(item: AccountControlConversationItem): boolean {
        return Boolean(pendingByConversation.get(conversationKey(item))?.id);
    }

    async function sendMessage() {
        const item = deps.selected.value;
        const draftText = text.value;
        const message = draftText.trim();
        const key = currentKey.value;
        const account = deps.account();
        if (
            !item ||
            !key ||
            !deps.canChat.value ||
            !deps.online.value ||
            !message ||
            pendingByConversation.get(key)?.busy ||
            pendingByConversation.get(key)?.id
        )
            return;
        const targetType =
            item.sceneType === "direct"
                ? "direct"
                : item.kind === "friend"
                  ? "private"
                  : item.kind === "group"
                    ? "group"
                    : "channel";
        update(key, { busy: true, error: "", status: undefined });
        const expected = await deps.ensureContext();
        if (
            !expected ||
            currentKey.value !== key ||
            deps.account() !== account ||
            !deps.online.value ||
            !deps.canChat.value
        ) {
            update(key, {
                busy: false,
                error:
                    currentKey.value !== key
                        ? ""
                        : !expected
                          ? "网关连接暂不可用。"
                          : !deps.canChat.value
                            ? "账号状态或发送能力已变化，请确认后重试。"
                            : "",
            });
            return;
        }
        const id = crypto.randomUUID();
        update(key, {
            id,
            status: "running",
            target: { key, text: draftText, label: item.name },
        });
        try {
            acceptSendResult(
                key,
                id,
                await deps.client.sendMessage({
                    id,
                    expected,
                    account,
                    targetType,
                    targetId: item.id,
                    ...(item.kind === "channel" && item.parentId ? { guildId: item.parentId } : {}),
                    message,
                }),
            );
        } catch {
            if (pendingByConversation.get(key)?.id === id)
                update(key, {
                    status: "unknown",
                    error: "发送结果暂不可确认。请查询操作，不要重复发送。",
                });
        } finally {
            if (pendingByConversation.get(key)?.id === id) update(key, { busy: false });
        }
    }

    function acceptSendResult(key: string, id: string, operation: ControlSendOperation) {
        const state = pendingByConversation.get(key);
        if (state?.id !== id) return;
        if (operation.status === "succeeded") {
            const target = state.target;
            const isCurrent = currentKey.value === key;
            if (target && isCurrent && text.value === target.text) text.value = "";
            // 页面重载后只恢复操作 ID，没有 target 正文；确认成功仍要刷新可见历史。
            if (isCurrent) deps.refreshHistory();
            if (target && drafts.get(target.key) === target.text) drafts.delete(target.key);
            clear(key);
        } else if (operation.status === "rejected") {
            update(key, {
                id: "",
                status: "rejected",
                target: undefined,
                error: "平台拒绝发送，请检查账号权限或目标。",
            });
        } else if (operation.status === "unknown") {
            update(key, {
                status: "unknown",
                error: "发送结果未知。请查询操作，不要重复发送。",
            });
        }
    }

    async function querySend() {
        const key = currentKey.value;
        const id = pendingByConversation.get(key)?.id;
        if (!id || pendingByConversation.get(key)?.busy) return;
        update(key, { busy: true });
        try {
            acceptSendResult(key, id, await deps.client.sendOperation(id));
        } catch {
            if (pendingByConversation.get(key)?.id === id)
                update(key, { error: "操作结果仍不可确认，请稍后查询。" });
        } finally {
            if (pendingByConversation.get(key)?.id === id) update(key, { busy: false });
        }
    }

    function requestAbandon() {
        confirmAbandon.value = true;
    }

    function cancelAbandon() {
        confirmAbandon.value = false;
    }

    function abandonTracking() {
        if (!confirmAbandon.value || pendingStatus.value !== "unknown") return;
        clear(currentKey.value);
        confirmAbandon.value = false;
    }

    return {
        text,
        sendBusy,
        sendError,
        pendingSendId,
        pendingStatus,
        pendingTargetLabel,
        hasPending,
        confirmAbandon,
        sendMessage,
        querySend,
        requestAbandon,
        cancelAbandon,
        abandonTracking,
    };
}
