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
                <span class="truncate font-mono text-xs text-fg-secondary">{{ bot.dependency }}</span>
            </div>

            <!-- 接入点 -->
            <template v-if="bot.urls && bot.urls.length">
                <div class="mt-1 flex items-center gap-2">
                    <span class="text-xs text-fg-tertiary">接入点</span>
                    <span class="h-px flex-1 bg-border"></span>
                </div>
                <div class="flex flex-col gap-1.5">
                    <a
                        v-for="url in bot.urls"
                        :key="url"
                        :href="getFullUrl(url)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="flex items-center gap-1.5 break-all font-mono text-xs text-accent hover:underline">
                        <IconLink :size="12" class="shrink-0" />
                        {{ url }}
                    </a>
                </div>
            </template>
        </div>

        <template #footer>
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1">
                    <RouterLink
                        :to="{ path: '/config', query: { tab: 'accounts', highlight: `${bot.platform}.${bot.uin}` } }"
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
                        v-if="bot.status === 'offline'"
                        variant="primary"
                        :loading="props.loading"
                        :disabled="props.loading"
                        class="w-28"
                        @click="emit('start', bot)">
                        <IconPlayerPlay v-if="!props.loading" :size="14" />
                        上线
                    </UiButton>
                    <UiButton
                        v-else-if="bot.status === 'online'"
                        variant="danger"
                        :loading="props.loading"
                        :disabled="props.loading"
                        class="w-28"
                        @click="emit('stop', bot)">
                        <IconPlayerPause v-if="!props.loading" :size="14" />
                        下线
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
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { IconLink, IconPlayerPlay, IconPlayerPause, IconSettings, IconFileText } from '@tabler/icons-vue';
import UiAvatar from '../ui/UiAvatar.vue';
import UiBadge from '../ui/UiBadge.vue';
import UiButton from '../ui/UiButton.vue';
import UiCard from '../ui/UiCard.vue';
import type { AccountInfo } from '../types';

interface Props {
    bot: AccountInfo;
    adapterIcon: string;
    loading?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
    start: [bot: AccountInfo];
    stop: [bot: AccountInfo];
}>();

const statusMeta = computed(() => {
    switch (props.bot.status) {
        case 'online':
            return { variant: 'success' as const, label: '在线' };
        case 'pending':
            return { variant: 'warning' as const, label: '连接中' };
        default:
            return { variant: 'neutral' as const, label: '离线' };
    }
});

// 使用当前页同源，协议地址可直接复制使用（HF/Docker/反向代理下端口正确）
const getFullUrl = (url: string) => {
    const base = import.meta.env.VITE_API_BASE || window.location.origin;
    const path = url.startsWith('/') ? url : `/${url}`;
    return `${base.replace(/\/$/, '')}${path}`;
};
</script>
