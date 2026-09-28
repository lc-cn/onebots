<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import type { ControlAccountItem } from "@onebots/core/control";
import { IconArrowLeft, IconDotsVertical, IconRefresh } from "@tabler/icons-vue";
import type { AccountControlConversationItem } from "../account-control-list.js";
import AccountControlContext from "./AccountControlContext.vue";
import { useAccountRetryFocus } from "../use-account-retry-focus.js";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{
    selected?: AccountControlConversationItem;
    activeItem?: ControlAccountItem;
    members: ControlAccountItem[];
    membersSupported: boolean;
    membersTruncated: boolean;
    memberLoading: boolean;
    memberError: string;
    detailError: string;
    detailSupported?: boolean;
    detailLoading: boolean;
    historyEnabled?: boolean;
    historyLoading: boolean;
    historyError: string;
}>();
const emit = defineEmits<{
    back: [];
    refresh: [];
    retryHistory: [];
    retryMembers: [];
    retryDetail: [];
    viewMembers: [];
    historySettings: [];
}>();
const mobileBack = ref<HTMLButtonElement>();
const conversationTitle = ref<HTMLElement>();
const actionsTrigger = ref<HTMLButtonElement>();
const actionsDialog = ref<HTMLDialogElement>();
const historyRetry = useAccountRetryFocus(
    toRef(props, "historyError"),
    toRef(props, "historyLoading"),
    conversationTitle,
);
let mobileQuery: MediaQueryList | undefined;

function closeActions() {
    if (actionsDialog.value?.open) actionsDialog.value.close();
}

function openActions() {
    if (!actionsDialog.value?.open) {
        actionsDialog.value?.showModal();
        if (
            props.selected &&
            props.selected.kind !== "friend" &&
            props.selected.sceneType !== "direct"
        )
            emit("viewMembers");
    }
}

function onMobileChange(event: MediaQueryListEvent) {
    closeActions();
    if (
        !event.matches &&
        props.selected &&
        props.selected.kind !== "friend" &&
        props.selected.sceneType !== "direct"
    )
        emit("viewMembers");
}

function onActionsClose() {
    // 原生 dialog 负责焦点约束；关闭后回到打开浮层的入口。
    if (actionsTrigger.value?.isConnected && mobileQuery?.matches) actionsTrigger.value.focus();
}

function refreshFromActions() {
    closeActions();
    if (!props.historyLoading) emit("refresh");
}

function openHistorySettings() {
    closeActions();
    emit("historySettings");
}

function retryHistory() {
    if (props.historyLoading) return;
    historyRetry.begin();
    emit("retryHistory");
}

onMounted(() => {
    mobileQuery = matchMedia("(max-width: 700px)");
    mobileQuery.addEventListener("change", onMobileChange);
});
onBeforeUnmount(() => {
    mobileQuery?.removeEventListener("change", onMobileChange);
    closeActions();
});
watch(
    () => props.selected,
    () => {
        closeActions();
        historyRetry.reset();
    },
);
defineExpose({ focusBack: () => mobileBack.value?.focus() });
</script>

<template>
    <header class="account-control-conversation-head">
        <button
            v-if="selected"
            ref="mobileBack"
            type="button"
            class="account-control-mobile-back"
            aria-label="切换会话"
            @click="emit('back')">
            <IconArrowLeft :size="17" aria-hidden="true" /> 会话列表
        </button>
        <div>
            <small>{{
                selected
                    ? selected.sceneType === "direct"
                        ? "直聊"
                        : selected.kind === "friend"
                          ? "私聊"
                          : selected.kind === "group"
                            ? "群聊"
                            : "频道"
                    : "账号控制"
            }}</small>
            <h2 ref="conversationTitle" tabindex="-1">
                {{ activeItem?.name ?? "选择一段对话" }}
            </h2>
        </div>
        <button
            v-if="selected"
            ref="actionsTrigger"
            type="button"
            class="account-control-actions-trigger"
            aria-haspopup="dialog"
            aria-controls="account-control-actions-dialog"
            aria-label="会话操作与详情"
            @click="openActions">
            <IconDotsVertical :size="19" aria-hidden="true" />
        </button>
        <UiButton
            v-if="selected"
            size="sm"
            class="account-control-refresh"
            aria-label="刷新消息"
            :aria-disabled="historyLoading"
            @click="!historyLoading && emit('refresh')">
            <IconRefresh :size="17" aria-hidden="true" />
            <span class="account-control-refresh-label">刷新消息</span>
        </UiButton>
        <button
            v-if="selected && historyEnabled === false"
            type="button"
            class="account-control-history-setting"
            @click="emit('historySettings')">
            新消息不再保存 · 前往历史设置
        </button>
        <div
            v-if="historyError"
            class="account-control-error account-control-history-error"
            role="alert">
            <p>{{ historyError }}</p>
            <UiButton size="sm" :aria-disabled="historyLoading" @click="retryHistory">
                {{ historyLoading ? "正在重试…" : "重试读取" }}
            </UiButton>
        </div>
        <dialog
            id="account-control-actions-dialog"
            ref="actionsDialog"
            class="account-control-actions-dialog"
            aria-label="会话操作与详情"
            @click.self="closeActions"
            @close="onActionsClose">
            <div class="account-control-actions-sheet">
                <div class="account-control-actions-sheet-head">
                    <strong>会话操作</strong>
                    <button type="button" @click="closeActions">关闭</button>
                </div>
                <div class="account-control-actions-list">
                    <button
                        type="button"
                        :aria-disabled="historyLoading"
                        @click="refreshFromActions">
                        <IconRefresh :size="18" aria-hidden="true" /> 刷新消息
                    </button>
                    <button
                        v-if="historyEnabled === false"
                        type="button"
                        @click="openHistorySettings">
                        历史记录已关闭 · 前往设置
                    </button>
                </div>
                <AccountControlContext
                    v-if="selected && selected.sceneType !== 'direct'"
                    :selected="selected"
                    :active-item="activeItem"
                    :members="members"
                    :members-supported="membersSupported"
                    :members-truncated="membersTruncated"
                    :member-loading="memberLoading"
                    :member-error="memberError"
                    :detail-error="detailError"
                    :detail-supported="detailSupported"
                    :detail-loading="detailLoading"
                    @retry-members="emit('retryMembers')"
                    @retry-detail="emit('retryDetail')" />
            </div>
        </dialog>
    </header>
</template>
