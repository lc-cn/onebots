<script setup lang="ts">
import { computed, reactive } from "vue";
import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import { IconArrowRight, IconRobot } from "@tabler/icons-vue";
import { accountImageUrl, buildAccountCards } from "../account-overview.js";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{
    platform: string;
    accountId: string;
    configuration?: ControlConfigurationSnapshot;
    status?: ControlStatus;
    catalog?: ControlInstallationCatalog;
}>();
const emit = defineEmits<{
    back: [];
    edit: [];
    remove: [];
    control: [];
    protocol: [protocolKey: string];
    addProtocol: [];
}>();
const failedImages = reactive(new Set<string>());
const card = computed(() =>
    buildAccountCards(
        props.configuration,
        props.status,
        props.catalog,
        window.location.origin,
    ).find(item => item.platform === props.platform && item.accountId === props.accountId),
);
const imageUrl = computed(() => card.value && accountImageUrl(card.value, failedImages));
const statusLabel = computed(() => {
    if (!card.value?.status)
        return props.status?.gateway.actual === "stopped" ? "网关未启动" : "状态待确认";
    return { online: "在线", offline: "离线", pending: "连接中" }[card.value.status];
});
</script>

<template>
    <section class="workspace-view entity-detail-page" aria-labelledby="account-detail-title">
        <button type="button" class="entity-back" @click="emit('back')">← 全部账号</button>
        <div v-if="!card" class="accounts-empty" role="status">
            <IconRobot :size="28" aria-hidden="true" />
            <h1>找不到此账号</h1>
            <p>账号可能已删除，或当前配置暂不可用。</p>
            <UiButton @click="emit('back')">返回账号列表</UiButton>
        </div>
        <template v-else>
            <header class="entity-detail-heading">
                <span class="account-logo" aria-hidden="true">
                    <img
                        v-if="imageUrl"
                        :src="imageUrl"
                        alt=""
                        width="60"
                        height="60"
                        referrerpolicy="no-referrer"
                        @error="imageUrl && failedImages.add(imageUrl)" />
                    <span v-else>{{ platform.slice(0, 2).toUpperCase() }}</span>
                </span>
                <div>
                    <span class="entity-eyebrow">{{ card.platformLabel }}账号</span>
                    <h1 id="account-detail-title">{{ accountId }}</h1>
                    <p class="account-status" :class="card.status ?? 'unknown'">
                        {{ statusLabel }}
                    </p>
                </div>
                <div class="entity-detail-actions">
                    <UiButton
                        v-if="card.status === 'online'"
                        variant="primary"
                        @click="emit('control')"
                        >打开控制台</UiButton
                    >
                    <UiButton @click="emit('edit')">编辑账号</UiButton>
                </div>
            </header>

            <section class="entity-detail-section" aria-labelledby="account-protocols-title">
                <div class="entity-section-heading">
                    <div>
                        <span class="entity-eyebrow">连接下游</span>
                        <h2 id="account-protocols-title">协议出口</h2>
                    </div>
                    <UiButton variant="primary" size="sm" @click="emit('addProtocol')"
                        >添加协议</UiButton
                    >
                </div>
                <p v-if="!card.protocols.length" class="entity-section-empty">
                    此账号尚未配置协议出口。添加后，下游应用才能连接它。
                </p>
                <div v-else class="entity-link-list">
                    <button
                        v-for="item in card.protocols"
                        :key="item.guide.id"
                        type="button"
                        class="entity-link-row"
                        @click="emit('protocol', item.guide.protocolKey)">
                        <span>
                            <strong>{{ item.guide.protocolLabel }}</strong>
                            <small>{{
                                item.status === "ready"
                                    ? "已就绪"
                                    : item.status === "failed"
                                      ? "连接失败"
                                      : "查看连接方式与状态"
                            }}</small>
                        </span>
                        <IconArrowRight :size="19" aria-hidden="true" />
                    </button>
                </div>
            </section>
            <section
                class="entity-detail-section entity-danger-section"
                aria-labelledby="account-manage-title">
                <h2 id="account-manage-title">管理账号</h2>
                <p>删除会同时移除这个账号配置的所有协议出口，保存并应用后生效。</p>
                <UiButton variant="danger" size="sm" @click="emit('remove')">删除账号</UiButton>
            </section>
        </template>
    </section>
</template>
