<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import { IconArrowRight, IconRobot } from "@tabler/icons-vue";
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
    detail: [platform: string, accountId: string];
    selectExtensions: [];
}>();
const cards = computed(() =>
    buildAccountCards(props.configuration, props.status, props.catalog, window.location.origin),
);
const onlineCount = computed(() => cards.value.filter(card => card.status === "online").length);
const platforms = computed(() =>
    buildExtensionTabs(
        props.catalog?.selection.adapters ?? [],
        props.catalog?.adapters ?? [],
        cards.value.map(card => card.platform),
    ),
);
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
function imageFor(card: AccountConnectionCard): string | undefined {
    return accountImageUrl(card, failedImages);
}
function failImage(card: AccountConnectionCard) {
    const value = imageFor(card);
    if (value) failedImages.add(value);
}
function accountStatusLabel(card: AccountConnectionCard) {
    if (card.status) return { online: "在线", offline: "离线", pending: "连接中" }[card.status];
    return props.status?.gateway.actual === "stopped" ? "未启动" : "状态待确认";
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
            <UiButton variant="primary" @click="emit('selectExtensions')">去安装平台</UiButton>
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
                <span v-if="!activePlatformInstalled">此平台依赖未安装；已有账号仍可查看。</span>
                <UiButton
                    v-if="activePlatformInstalled"
                    variant="primary"
                    size="sm"
                    @click="emit('configure', activePlatform, '')"
                    >添加账号</UiButton
                >
                <UiButton v-else variant="ghost" size="sm" @click="emit('selectExtensions')"
                    >安装平台</UiButton
                >
            </div>
            <div v-if="!visibleCards.length" class="accounts-empty">
                <IconRobot :size="30" aria-hidden="true" />
                <h2>还没有账号</h2>
                <p>
                    添加一个 {{ platforms.find(item => item.key === activePlatform)?.label }} 账号。
                </p>
            </div>
            <div v-else class="account-card-list">
                <button
                    v-for="card in visibleCards"
                    :key="card.id"
                    type="button"
                    class="account-card entity-list-card"
                    @click="emit('detail', card.platform, card.accountId)">
                    <span class="account-identity">
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
                        <span
                            ><small class="account-platform">{{ card.platformLabel }}</small
                            ><strong>{{ card.accountId }}</strong></span
                        >
                    </span>
                    <span class="entity-list-meta">
                        <span class="account-status" :class="card.status ?? 'unknown'">{{
                            accountStatusLabel(card)
                        }}</span>
                        <small>{{ card.protocols.length }} 个协议出口</small>
                    </span>
                    <IconArrowRight :size="19" aria-hidden="true" />
                </button>
            </div>
        </template>
    </section>
</template>
