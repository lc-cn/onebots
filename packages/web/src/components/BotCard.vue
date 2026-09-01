<template>
    <UiCard class="hover:border-border-strong">
        <template #header>
            <UiAvatar :src="bot.avatar" :name="bot.nickname" :size="40" />
            <div class="min-w-0 flex-1">
                <div class="truncate font-medium text-fg">{{ bot.nickname }}</div>
                <div class="font-mono text-xs text-fg-tertiary">{{ bot.uin }}</div>
            </div>
        </template>

        <div class="flex flex-col gap-2.5">
            <!-- 状态 -->
            <div class="flex items-center gap-3 text-sm">
                <span class="w-12 shrink-0 text-xs text-fg-tertiary">状态</span>
                <UiBadge :variant="statusMeta.variant" dot>{{ statusMeta.label }}</UiBadge>
            </div>
            <!-- 平台 -->
            <div class="flex items-center gap-3 text-sm">
                <span class="w-12 shrink-0 text-xs text-fg-tertiary">平台</span>
                <span class="flex items-center gap-2 text-fg-secondary">
                    <UiAvatar :src="adapterIcon" :size="20" />
                    {{ bot.platform }}
                </span>
            </div>
            <!-- 依赖 -->
            <div v-if="bot.dependency" class="flex items-center gap-3 text-sm">
                <span class="w-12 shrink-0 text-xs text-fg-tertiary">依赖</span>
                <span class="truncate font-mono text-xs text-fg-secondary">{{
                    bot.dependency
                }}</span>
            </div>

            <!-- 协议出口 -->
            <template v-if="bot.protocols && bot.protocols.length">
                <div class="mt-1 flex items-center gap-2">
                    <span class="text-xs text-fg-tertiary">协议出口</span>
                    <span class="h-px flex-1 bg-border"></span>
                </div>
                <div class="flex flex-col gap-1.5">
                    <div
                        v-for="protocol in bot.protocols"
                        :key="`${protocol.name}.${protocol.version}:${protocol.path}`"
                        class="rounded-control border border-border bg-surface px-2.5 py-2">
                        <div class="mb-1 flex items-center justify-between gap-2">
                            <span class="font-mono text-xs text-fg-secondary">
                                {{ protocol.name }}.{{ protocol.version }}
                            </span>
                            <UiBadge
                                :variant="protocolStatusMeta(protocol.lifecycleStatus).variant"
                                dot>
                                {{ protocolStatusMeta(protocol.lifecycleStatus).label }}
                            </UiBadge>
                        </div>
                        <a
                            :href="getFullUrl(protocol.path)"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="flex items-center gap-1.5 break-all font-mono text-xs text-accent hover:underline">
                            <IconLink :size="12" class="shrink-0" />
                            {{ protocol.path }}
                        </a>
                    </div>
                </div>
            </template>
        </div>

        <template #footer>
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1">
                    <RouterLink
                        :to="{
                            path: '/config',
                            query: { tab: 'accounts', highlight: `${bot.platform}.${bot.uin}` },
                        }"
                        title="编辑配置"
                        class="inline-flex h-8 w-8 items-center justify-center rounded-control text-fg-tertiary transition-colors hover:bg-surface-raised hover:text-fg">
                        <IconSettings :size="15" />
                    </RouterLink>
                    <RouterLink
                        :to="{ path: '/logs', query: { search: bot.uin } }"
                        title="查看日志"
                        class="inline-flex h-8 w-8 items-center justify-center rounded-control text-fg-tertiary transition-colors hover:bg-surface-raised hover:text-fg">
                        <IconFileText :size="15" />
                    </RouterLink>
                </div>
                <div>
                    <UiButton
                        v-if="bot.status === 'offline' && lifecycleControl?.online"
                        variant="primary"
                        :loading="props.loading"
                        :disabled="props.loading"
                        class="w-28"
                        @click="emit('start', bot)">
                        <IconPlayerPlay v-if="!props.loading" :size="14" />
                        上线
                    </UiButton>
                    <UiButton
                        v-else-if="bot.status === 'online' && lifecycleControl?.offline"
                        variant="danger"
                        :loading="props.loading"
                        :disabled="props.loading"
                        class="w-28"
                        @click="emit('stop', bot)">
                        <IconPlayerPause v-if="!props.loading" :size="14" />
                        下线
                    </UiButton>
                    <UiButton
                        v-else-if="bot.status === 'offline' || bot.status === 'online'"
                        variant="secondary"
                        disabled
                        class="w-28"
                        :title="
                            bot.status === 'offline'
                                ? '此适配器不支持手动上线账号'
                                : '此适配器不支持手动下线账号'
                        ">
                        不支持手动切换
                    </UiButton>
                    <UiButton v-else variant="secondary" loading disabled class="w-28">
                        连接中
                    </UiButton>
                </div>
            </div>
        </template>
    </UiCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import {
    IconLink,
    IconPlayerPlay,
    IconPlayerPause,
    IconSettings,
    IconFileText,
} from "@tabler/icons-vue";
import UiAvatar from "../ui/UiAvatar.vue";
import UiBadge from "../ui/UiBadge.vue";
import UiButton from "../ui/UiButton.vue";
import UiCard from "../ui/UiCard.vue";
import type { AccountInfo } from "../types";
import { buildApiUrl } from "../config";

interface Props {
    bot: AccountInfo;
    adapterIcon: string;
    lifecycleControl?: { online: boolean; offline: boolean };
    loading?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
    start: [bot: AccountInfo];
    stop: [bot: AccountInfo];
}>();

const statusMeta = computed(() => {
    switch (props.bot.status) {
        case "online":
            return { variant: "success" as const, label: "在线" };
        case "pending":
            return { variant: "warning" as const, label: "连接中" };
        default:
            return { variant: "neutral" as const, label: "离线" };
    }
});

const protocolStatusMeta = (status: AccountInfo["protocols"][number]["lifecycleStatus"]) => {
    switch (status) {
        case "ready":
            return { variant: "success" as const, label: "就绪" };
        case "starting":
            return { variant: "warning" as const, label: "启动中" };
        case "stopping":
            return { variant: "warning" as const, label: "停止中" };
        case "failed":
            return { variant: "danger" as const, label: "失败" };
        case "stopped":
            return { variant: "neutral" as const, label: "已停止" };
        default:
            return { variant: "neutral" as const, label: "等待启动" };
    }
};

// 复用管理 HTTP 地址，确保协议链接包含运行时前缀或显式 API base。
const getFullUrl = (url: string) => {
    const path = url.startsWith("/") ? url : `/${url}`;
    return new URL(buildApiUrl(path), window.location.origin).toString();
};
</script>
