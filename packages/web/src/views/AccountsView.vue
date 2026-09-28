<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import { IconDotsVertical, IconRobot } from "@tabler/icons-vue";
import {
    accountImageUrl,
    buildAccountCards,
    type AccountConnectionCard,
} from "../account-overview.js";
import { buildExtensionTabs } from "../extension-tabs.js";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{
    configuration?: ControlConfigurationSnapshot;
    status?: ControlStatus;
    catalog?: ControlInstallationCatalog;
    configurationUnavailable?: boolean;
}>();
const emit = defineEmits<{
    configure: [platform: string, accountId: string];
    showProtocols: [platform: string, accountId: string];
    remove: [platform: string, accountId: string];
    control: [platform: string, accountId: string];
    selectExtensions: [];
}>();
const cards = computed(() =>
    buildAccountCards(props.configuration, props.status, props.catalog, window.location.origin),
);
const onlineCount = computed(() => cards.value.filter(card => card.status === "online").length);
const platforms = computed(() => {
    return buildExtensionTabs(
        props.catalog?.selection.adapters ?? [],
        props.catalog?.adapters ?? [],
        cards.value.map(card => card.platform),
    );
});
const activePlatform = ref("");
watch(
    platforms,
    value => {
        if (!value.some(item => item.key === activePlatform.value))
            activePlatform.value = value[0]?.key ?? "";
    },
    { immediate: true },
);
const visibleCards = computed(() =>
    cards.value.filter(card => card.platform === activePlatform.value),
);
const activePlatformInstalled = computed(
    () => platforms.value.find(item => item.key === activePlatform.value)?.installed,
);
const failedImages = reactive(new Set<string>());
const actionsDialog = ref<HTMLDialogElement>();
const actionAccount = ref<{ platform: string; accountId: string }>();
const actionCard = computed(() =>
    cards.value.find(
        card =>
            card.platform === actionAccount.value?.platform &&
            card.accountId === actionAccount.value?.accountId,
    ),
);
let actionsTrigger: HTMLButtonElement | undefined;
let mobileQuery: MediaQueryList | undefined;

function closeActions() {
    if (actionsDialog.value?.open) actionsDialog.value.close();
}

function openActions(card: AccountConnectionCard, event: MouseEvent) {
    actionsTrigger = event.currentTarget as HTMLButtonElement;
    actionAccount.value = { platform: card.platform, accountId: card.accountId };
    actionsDialog.value?.showModal();
}

function onActionsClose() {
    if (mobileQuery?.matches && actionsTrigger?.isConnected) actionsTrigger.focus();
    actionAccount.value = undefined;
    actionsTrigger = undefined;
}

function actOnAccount(action: "configure" | "remove") {
    const card = actionCard.value;
    if (!card) return;
    closeActions();
    if (action === "configure") emit("configure", card.platform, card.accountId);
    else emit("remove", card.platform, card.accountId);
}

onMounted(() => {
    mobileQuery = matchMedia("(max-width: 640px)");
    mobileQuery.addEventListener("change", closeActions);
});
onBeforeUnmount(() => {
    mobileQuery?.removeEventListener("change", closeActions);
    closeActions();
});
watch(actionCard, card => {
    if (!card) closeActions();
});

const accountStatusLabel = (card: AccountConnectionCard) => {
    if (card.status) return { online: "在线", offline: "离线", pending: "连接中" }[card.status];
    return props.status?.gateway.actual === "stopped" ? "未启动" : "状态待确认";
};

function imageFor(card: AccountConnectionCard): string | undefined {
    return accountImageUrl(card, failedImages);
}

function failImage(card: AccountConnectionCard) {
    const current = imageFor(card);
    if (current) failedImages.add(current);
}
</script>

<template>
    <section class="workspace-view accounts-workspace" aria-labelledby="accounts-title">
        <header class="page-heading accounts-heading">
            <div>
                <h1 id="accounts-title">账号</h1>
                <p>{{ cards.length }} 个账号 · {{ onlineCount }} 个在线</p>
            </div>
        </header>

        <p v-if="!configuration && configurationUnavailable" class="accounts-warning" role="alert">
            配置暂不可用；仅显示网关已上报的账号状态。
        </p>

        <div v-if="!catalog && !cards.length" class="accounts-empty" role="status">
            {{ configurationUnavailable ? "账号信息暂不可用" : "正在读取账号状态…" }}
        </div>
        <div v-else-if="!platforms.length" class="accounts-empty">
            <IconRobot :size="30" aria-hidden="true" />
            <h2>还没有任何平台能接入呢</h2>
            <p>先去扩展安装平台，安装后就能在这里添加账号。</p>
            <div>
                <UiButton variant="primary" @click="emit('selectExtensions')">去安装平台</UiButton>
            </div>
        </div>
        <template v-else>
            <div class="entity-tabs" role="group" aria-label="平台分类">
                <button
                    v-for="item in platforms"
                    :key="item.key"
                    type="button"
                    :aria-pressed="activePlatform === item.key"
                    :class="{ active: activePlatform === item.key }"
                    @click="activePlatform = item.key">
                    {{ item.label }} <span>{{ item.count }}</span>
                </button>
            </div>
            <div class="entity-tab-actions">
                <span v-if="!activePlatformInstalled">此平台依赖未安装；可删除旧账号配置。</span>
                <UiButton
                    v-if="activePlatformInstalled"
                    variant="primary"
                    size="sm"
                    @click="emit('configure', activePlatform, '')"
                    >添加</UiButton
                >
                <UiButton v-else variant="ghost" size="sm" @click="emit('selectExtensions')"
                    >安装平台</UiButton
                >
            </div>
            <div v-if="!visibleCards.length" class="accounts-empty">
                <IconRobot :size="30" aria-hidden="true" />
                <h2>还没有账号</h2>
                <p>
                    点击“添加”，创建第一个
                    {{ platforms.find(item => item.key === activePlatform)?.label }} 账号。
                </p>
            </div>
            <div v-else class="account-card-list">
                <article v-for="card in visibleCards" :key="card.id" class="account-card">
                    <header class="account-card-heading">
                        <div class="account-identity">
                            <span class="account-logo" aria-hidden="true">
                                <img
                                    v-if="imageFor(card)"
                                    :src="imageFor(card)"
                                    alt=""
                                    width="52"
                                    height="52"
                                    loading="lazy"
                                    referrerpolicy="no-referrer"
                                    @error="failImage(card)" />
                                <span v-else>{{ card.platform.slice(0, 2).toUpperCase() }}</span>
                            </span>
                            <div>
                                <span class="account-platform">{{ card.platformLabel }}</span>
                                <h2>{{ card.accountId }}</h2>
                                <span
                                    class="account-status account-status-mobile"
                                    :class="card.status ?? 'unknown'">
                                    {{ accountStatusLabel(card) }}
                                </span>
                            </div>
                        </div>
                        <div class="account-card-actions">
                            <span class="account-status" :class="card.status ?? 'unknown'">
                                {{ accountStatusLabel(card) }}
                            </span>
                            <UiButton
                                v-if="card.status === 'online'"
                                variant="primary"
                                size="sm"
                                @click="emit('control', card.platform, card.accountId)"
                                >控制</UiButton
                            >
                            <UiButton
                                variant="ghost"
                                size="sm"
                                class="account-card-desktop-action"
                                @click="emit('configure', card.platform, card.accountId)">
                                编辑
                            </UiButton>
                            <UiButton
                                variant="ghost"
                                size="sm"
                                class="account-card-desktop-action"
                                @click="emit('remove', card.platform, card.accountId)"
                                >删除</UiButton
                            >
                            <button
                                type="button"
                                class="account-card-mobile-action"
                                :aria-label="`${card.accountId} 的更多操作`"
                                aria-haspopup="dialog"
                                aria-controls="account-card-actions-dialog"
                                @click="openActions(card, $event)">
                                <IconDotsVertical :size="19" aria-hidden="true" />
                            </button>
                        </div>
                    </header>

                    <div class="account-protocol-empty">
                        <span>{{
                            card.protocols.length
                                ? `${card.protocols.length} 个协议出口`
                                : "尚未添加协议出口"
                        }}</span>
                        <UiButton
                            variant="ghost"
                            size="sm"
                            @click="emit('showProtocols', card.platform, card.accountId)">
                            {{ card.protocols.length ? "查看协议" : "添加协议" }}
                        </UiButton>
                    </div>
                </article>
            </div>
        </template>
        <dialog
            id="account-card-actions-dialog"
            ref="actionsDialog"
            class="account-card-actions-dialog"
            :aria-label="actionCard ? `${actionCard.accountId} 的账号操作` : '账号操作'"
            @click.self="closeActions"
            @close="onActionsClose">
            <div v-if="actionCard" class="account-card-actions-sheet">
                <div class="account-card-actions-sheet-head">
                    <div>
                        <strong>{{ actionCard.accountId }}</strong
                        ><small>{{ actionCard.platformLabel }}</small>
                    </div>
                    <button type="button" @click="closeActions">关闭</button>
                </div>
                <div class="account-card-actions-list">
                    <button type="button" @click="actOnAccount('configure')">编辑账号</button>
                    <button type="button" class="danger" @click="actOnAccount('remove')">
                        删除账号
                    </button>
                </div>
            </div>
        </dialog>
        <div id="account-configuration-target" class="configuration-owner-target"></div>
    </section>
</template>
