<script setup lang="ts">
import { onMounted, ref } from "vue";
import type {
    ControlClient,
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import { IconSend } from "@tabler/icons-vue";
import AccountControlConversationHead from "../components/AccountControlConversationHead.vue";
import AccountControlContext from "../components/AccountControlContext.vue";
import AccountControlHeader from "../components/AccountControlHeader.vue";
import AccountControlListToolbar from "../components/AccountControlListToolbar.vue";
import AccountControlManualEntry from "../components/AccountControlManualEntry.vue";
import AccountControlHistory from "../components/AccountControlHistory.vue";
import AccountControlMessageInput from "../components/AccountControlMessageInput.vue";
import { accountControlItemKey } from "../account-control-list.js";
import { useAccountControl } from "../use-account-control.js";
import { useAccountControlInteractions } from "../use-account-control-interactions.js";
import { useAccountConversationList } from "../use-account-conversation-list.js";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{
    client: ControlClient;
    platform: string;
    accountId: string;
    status?: ControlStatus;
    statusError?: string;
    configuration?: ControlConfigurationSnapshot;
    catalog?: ControlInstallationCatalog;
}>();
const emit = defineEmits<{ back: []; historySettings: []; retryStatus: [] }>();
const {
    account,
    online,
    category,
    categories,
    selectedGuild,
    visibleList,
    recentHasMore,
    recentOlderLoading,
    recentOlderError,
    filteredItems,
    contactSearch,
    manualTargetLabel,
    selected,
    activeItem,
    members,
    membersSupported,
    membersTruncated,
    memberLoading,
    memberError,
    detailError,
    detailSupported,
    detailLoading,
    messages,
    historyLoading,
    historyError,
    historyRetryOlder,
    moreHistory,
    text,
    manualId,
    sendBusy,
    queryBusy,
    sendError,
    pendingSendId,
    pendingStatus,
    canChat,
    sendCapabilityPending,
    sendCapabilityLoading,
    sendUnsupported,
    pendingTargetLabel,
    hasPending,
    confirmAbandon,
    loadOlderRecent,
    loadList,
    loadMembers,
    ensureMembersForSelection,
    loadDetail,
    refreshVisibleList,
    leaveGuild,
    clearSelection,
    choose,
    loadHistory,
    openManual,
    sendMessage,
    querySend,
    requestAbandon,
    cancelAbandon,
    abandonTracking,
} = useAccountControl(props);
const historyView = ref<InstanceType<typeof AccountControlHistory>>();
const {
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
} = useAccountControlInteractions({
    selected,
    canChat,
    text,
    sendBusy,
    pendingSendId,
    sendCapabilityLoading,
    choose,
    clearSelection,
    openManual,
    loadFriendList: () => loadList("friend", true),
    sendMessage,
    querySend,
});
const historyEnabled = ref<boolean>();
const {
    dialog: contactsDialog,
    opened: mobileListOpen,
    open: openConversationList,
    close: closeConversationList,
    onClose: onConversationListClose,
    openTarget,
} = useAccountConversationList({
    panel: contactsPanel,
    focusBack: () => conversationHead.value?.focusBack(),
    returnToList,
});

async function openItemFromList(item: Parameters<typeof openItem>[0]) {
    await openTarget(() => openItem(item));
}

async function openManualFromList() {
    await openTarget(openManualItem);
}

onMounted(async () => {
    try {
        historyEnabled.value = (await props.client.chatHistorySettings()).enabled;
    } catch {
        // 管理服务暂不可用时仍可查看会话；历史查询会展示自己的错误状态。
    }
});
</script>

<template>
    <section class="workspace-view account-control" aria-labelledby="account-control-title">
        <AccountControlHeader
            :account="account"
            :platform="platform"
            :account-id="accountId"
            :connection-state="!status || statusError ? 'unknown' : online ? 'online' : 'offline'"
            @back="emit('back')" />

        <div v-if="!status" class="accounts-empty" :role="statusError ? 'alert' : 'status'">
            <h2>{{ statusError ? "暂时无法读取账号状态" : "正在读取账号状态…" }}</h2>
            <p v-if="statusError">管理服务暂不可用，请检查连接后重试。</p>
            <p v-else>正在确认账号与网关的连接状态。</p>
            <UiButton v-if="statusError" @click="emit('retryStatus')">重试读取</UiButton>
            <UiButton @click="emit('back')">返回账号</UiButton>
        </div>
        <div v-else-if="!online && !statusError" class="accounts-empty" role="status">
            <h2>账号当前不在线</h2>
            <p>控制页需要实时连接；聊天记录会保留，账号恢复后可继续使用。</p>
            <UiButton @click="emit('back')">返回账号</UiButton>
        </div>
        <div v-else-if="statusError" class="account-control-status-warning" role="alert">
            <span>{{
                online
                    ? "管理状态暂不可确认，已暂停发送；已加载的会话仍可查看。"
                    : "管理状态暂不可确认，无法进入实时控制页。"
            }}</span>
            <div>
                <UiButton size="sm" @click="emit('retryStatus')">重试状态</UiButton>
                <UiButton v-if="!online" size="sm" @click="emit('back')">返回账号</UiButton>
            </div>
        </div>
        <div
            v-if="status && online"
            class="account-control-grid"
            :class="{
                'has-selection': selected,
                'has-context': selected && selected.sceneType !== 'direct',
                'status-unconfirmed': Boolean(statusError),
            }">
            <Teleport
                :to="contactsDialog ?? '#account-control-contacts-dialog'"
                :disabled="!mobileListOpen">
                <aside
                    ref="contactsPanel"
                    class="account-control-contacts"
                    aria-label="联系人与会话"
                    tabindex="-1">
                    <AccountControlListToolbar
                        v-model:category="category"
                        :categories="categories"
                        :selected-guild="selectedGuild"
                        :loading="visibleList.loading"
                        @leave-guild="leaveGuild"
                        @refresh="refreshVisibleList" />
                    <div class="account-control-search">
                        <input
                            ref="contactSearchInput"
                            v-model="contactSearch"
                            type="search"
                            name="contact-search"
                            :aria-label="
                                category === 'recent' ? '搜索已加载的会话' : '搜索已加载的联系人'
                            "
                            placeholder="搜索名称或 ID…"
                            autocomplete="off"
                            spellcheck="false" />
                        <small v-if="visibleList.items.length"
                            >{{ filteredItems.length }} / {{ visibleList.items.length }}</small
                        >
                    </div>
                    <div class="account-control-list">
                        <p
                            v-if="visibleList.loading && !visibleList.loaded"
                            class="account-control-hint">
                            正在读取…
                        </p>
                        <div
                            v-else-if="visibleList.error && !visibleList.items.length"
                            class="account-control-error"
                            role="alert">
                            <p>{{ visibleList.error }}</p>
                            <UiButton size="sm" @click="refreshVisibleList"> 重试读取 </UiButton>
                        </div>
                        <p
                            v-else-if="category === 'recent' && !visibleList.items.length"
                            class="account-control-hint">
                            {{
                                historyEnabled === false
                                    ? "暂无已保存的会话；当前已关闭聊天记录保存。"
                                    : "暂无已保存的会话。新消息到达后会出现在这里。"
                            }}
                        </p>
                        <p v-else-if="!visibleList.supported" class="account-control-hint">
                            此平台暂不支持读取{{
                                category === "channel" && selectedGuild
                                    ? "频道"
                                    : categories.find(item => item.id === category)?.label
                            }}列表，可在下方按 ID 打开会话。
                        </p>
                        <p v-else-if="!visibleList.items.length" class="account-control-hint">
                            还没有可展示的{{
                                category === "channel" && selectedGuild
                                    ? "频道"
                                    : categories.find(item => item.id === category)?.label
                            }}。
                        </p>
                        <p v-else-if="!filteredItems.length" class="account-control-hint">
                            已加载的列表中没有匹配项。
                        </p>
                        <ul class="account-control-items">
                            <li v-for="item in filteredItems" :key="accountControlItemKey(item)">
                                <button
                                    type="button"
                                    class="account-control-contact"
                                    :class="{
                                        active:
                                            selected?.id === item.id &&
                                            selected?.kind === item.kind &&
                                            selected?.sceneType === item.sceneType &&
                                            selected?.parentId === item.parentId,
                                    }"
                                    :aria-current="
                                        selected?.id === item.id &&
                                        selected?.kind === item.kind &&
                                        selected?.sceneType === item.sceneType &&
                                        selected?.parentId === item.parentId
                                            ? 'true'
                                            : undefined
                                    "
                                    @click="openItemFromList(item)">
                                    <span class="account-control-monogram" aria-hidden="true">{{
                                        item.name.slice(0, 1)
                                    }}</span>
                                    <span
                                        ><strong>{{ item.name }}</strong
                                        ><small>{{
                                            item.latestText ?? item.subtitle ?? item.id
                                        }}</small></span
                                    >
                                    <span
                                        v-if="hasPending(item)"
                                        class="account-control-pending-mark"
                                        aria-label="有待确认的发送操作"
                                        >待确认</span
                                    >
                                    <span
                                        v-else-if="item.sceneType === 'direct'"
                                        class="account-control-scene-mark"
                                        >直聊</span
                                    >
                                    <span v-if="item.kind === 'guild'" aria-hidden="true">→</span>
                                </button>
                            </li>
                        </ul>
                        <div
                            v-if="visibleList.error && visibleList.items.length"
                            class="account-control-error"
                            role="alert">
                            <p>{{ visibleList.error }} 已显示上次读取的列表。</p>
                            <UiButton size="sm" @click="refreshVisibleList">重试读取</UiButton>
                        </div>
                        <div
                            v-if="category === 'recent' && recentHasMore"
                            class="account-control-recent-more">
                            <UiButton
                                size="sm"
                                :disabled="recentOlderLoading"
                                @click="loadOlderRecent">
                                {{ recentOlderLoading ? "正在读取…" : "加载更早会话" }}
                            </UiButton>
                            <p v-if="recentOlderError" class="account-control-error" role="alert">
                                {{ recentOlderError }}
                            </p>
                        </div>
                        <p
                            v-if="visibleList.truncated && !visibleList.loading"
                            class="account-control-hint">
                            列表未全部读取，目前展示 {{ visibleList.items.length }} 个条目。
                        </p>
                    </div>
                    <AccountControlManualEntry
                        v-if="category !== 'recent'"
                        v-model="manualId"
                        :target-label="manualTargetLabel"
                        @submit="openManualFromList" />
                </aside>
            </Teleport>

            <main class="account-control-conversation">
                <AccountControlConversationHead
                    ref="conversationHead"
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
                    :history-enabled="historyEnabled"
                    :history-loading="historyLoading"
                    :history-error="historyError"
                    @back="openConversationList"
                    @refresh="loadHistory()"
                    @retry-history="historyRetryOlder ? historyView?.loadOlder() : loadHistory()"
                    @retry-members="selected && loadMembers(selected)"
                    @view-members="ensureMembersForSelection"
                    @retry-detail="selected && loadDetail(selected)"
                    @history-settings="emit('historySettings')" />
                <AccountControlHistory
                    ref="historyView"
                    :selected="selected"
                    :messages="messages"
                    :loading="historyLoading"
                    :error="historyError"
                    :enabled="historyEnabled"
                    :has-more="moreHistory"
                    :load-history="loadHistory" />
                <form
                    v-if="selected"
                    class="account-control-composer"
                    @submit.prevent="submitMessage">
                    <label for="account-control-input">消息</label>
                    <p v-if="sendUnsupported" class="account-control-hint" role="status">
                        此平台未声明向当前会话类型发送消息的能力；仍可查看已保存的记录。
                    </p>
                    <div
                        v-else-if="sendCapabilityPending"
                        class="account-control-hint account-control-capability-pending"
                        role="status">
                        <p>
                            {{
                                sendCapabilityLoading
                                    ? "正在确认发送能力…"
                                    : "发送能力暂未确认，仍可查看历史。"
                            }}
                        </p>
                        <UiButton
                            size="sm"
                            type="button"
                            :aria-disabled="sendCapabilityLoading"
                            @click="retrySendCapability">
                            {{ sendCapabilityLoading ? "正在确认…" : "重新确认" }}
                        </UiButton>
                    </div>
                    <AccountControlMessageInput
                        ref="composerInput"
                        v-model="text"
                        :disabled="!canChat || !online || !!pendingSendId"
                        :placeholder="
                            statusError
                                ? '管理状态待确认，暂不能发送'
                                : canChat
                                  ? '输入纯文本消息…'
                                  : sendUnsupported
                                    ? '当前会话不支持发送'
                                    : sendCapabilityPending
                                      ? '发送能力尚未确认'
                                      : '先选择一个会话'
                        "
                        @send="submitMessage" />
                    <div class="account-control-compose-actions">
                        <span>Ctrl / ⌘ + Enter 发送</span>
                        <UiButton
                            type="submit"
                            variant="primary"
                            :disabled="!canChat || !text.trim()"
                            :aria-disabled="!!pendingSendId || sendBusy"
                            :aria-busy="sendBusy">
                            <IconSend :size="16" aria-hidden="true" />
                            {{ queryBusy ? "正在查询…" : sendBusy ? "正在发送…" : "发送" }}
                        </UiButton>
                    </div>
                    <div
                        v-if="sendError || pendingSendId"
                        ref="sendState"
                        class="account-control-send-state"
                        role="status">
                        <span
                            >{{ pendingTargetLabel ? `发往 ${pendingTargetLabel}：` : ""
                            }}{{ sendError || "正在确认发送结果…" }}</span
                        >
                        <UiButton
                            v-if="pendingSendId"
                            size="sm"
                            data-query-send
                            :aria-disabled="sendBusy"
                            @click="querySendAndFocus"
                            >查询结果</UiButton
                        >
                        <button
                            v-if="pendingStatus === 'unknown' && !confirmAbandon"
                            type="button"
                            :disabled="sendBusy"
                            @click="requestAbandon">
                            放弃追踪
                        </button>
                        <div v-if="confirmAbandon" class="account-control-abandon-confirm">
                            <span>消息可能已发出。放弃后仍可查看历史，但无法再查询这次操作。</span>
                            <button type="button" @click="cancelAbandon">继续追踪</button>
                            <button type="button" :disabled="sendBusy" @click="abandonTracking">
                                确认放弃
                            </button>
                        </div>
                    </div>
                </form>
            </main>

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
                @retry-members="loadMembers(selected)"
                @retry-detail="loadDetail(selected)" />
        </div>
        <dialog
            id="account-control-contacts-dialog"
            ref="contactsDialog"
            class="account-control-contacts-dialog"
            aria-label="切换会话"
            @click.self="closeConversationList"
            @close="onConversationListClose">
            <div class="account-control-contacts-sheet-head">
                <strong>切换会话</strong>
                <button type="button" @click="closeConversationList">关闭</button>
            </div>
        </dialog>
    </section>
</template>
