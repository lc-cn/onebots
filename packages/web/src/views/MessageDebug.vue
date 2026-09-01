<template>
    <div class="mx-auto flex h-full w-full max-w-[1400px] flex-col px-4 py-4 sm:px-6 sm:py-6">
        <header class="mb-4 flex flex-col gap-3">
            <div class="flex items-center justify-between gap-4">
                <h2 class="flex items-center gap-2 text-xl font-semibold text-fg">
                    <IconBug :size="22" class="text-fg-secondary" />
                    消息调试
                </h2>
                <div class="flex items-center gap-2">
                    <UiBadge :variant="isConnected ? 'success' : 'danger'" dot>
                        {{ isConnected ? '已连接' : '未连接' }}
                    </UiBadge>
                    <UiButton variant="secondary" size="sm" @click="clearEntries">
                        <IconTrash :size="14" />
                        清空
                    </UiButton>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-3">
                <div class="w-40 shrink-0">
                    <UiSelect v-model="platformFilter" :options="platformOptions" placeholder="全部平台" />
                </div>
                <div class="w-32 shrink-0">
                    <UiSelect v-model="directionFilter" :options="directionOptions" placeholder="全部方向" />
                </div>
                <div class="relative w-56 shrink-0">
                    <IconSearch
                        :size="14"
                        class="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-fg-tertiary"
                    />
                    <UiInput v-model="searchKeyword" placeholder="搜索账号 / 内容..." clearable class="[&_input]:pl-8" />
                </div>
                <label class="ml-auto flex items-center gap-1.5 text-xs text-fg-tertiary">
                    <input v-model="autoScroll" type="checkbox" class="accent-accent" />
                    自动滚动
                </label>
                <span v-if="entries.length > 0" class="text-xs tabular-nums text-fg-tertiary">
                    {{ filteredEntries.length }}/{{ entries.length }} 条
                </span>
            </div>
        </header>

        <div
            ref="listContainer"
            class="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-card border border-border bg-surface p-3"
        >
            <UiEmpty v-if="filteredEntries.length === 0" description="暂无消息，等待适配器收发消息…" />

            <div
                v-for="entry in filteredEntries"
                :key="entry.seq"
                class="rounded-control border border-border bg-surface-raised"
            >
                <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                    @click="toggleExpanded(entry.seq)"
                >
                    <IconChevronRight
                        :size="14"
                        class="shrink-0 text-fg-tertiary transition-transform duration-150"
                        :class="{ 'rotate-90': expanded.has(entry.seq) }"
                    />
                    <UiBadge :variant="entry.direction === 'inbound' ? 'info' : 'success'">
                        {{ entry.direction === 'inbound' ? '收到' : '下发' }}
                    </UiBadge>
                    <UiBadge variant="neutral">{{ entry.platform }}</UiBadge>
                    <span class="truncate text-fg-secondary">{{ entry.account_id }}</span>
                    <UiBadge v-if="entry.protocol" variant="accent">
                        {{ entry.protocol }}/{{ entry.version }}
                    </UiBadge>
                    <span class="ml-auto shrink-0 text-xs tabular-nums text-fg-tertiary">
                        {{ formatTime(entry.time) }}
                    </span>
                </button>
                <div v-if="expanded.has(entry.seq)" class="border-t border-border px-3 py-2">
                    <div class="mb-1.5 flex justify-end">
                        <UiButton variant="ghost" size="sm" @click="copyPayload(entry)">
                            <IconCopy :size="12" />
                            复制
                        </UiButton>
                    </div>
                    <pre class="max-h-80 overflow-auto rounded-control bg-surface p-2.5 text-xs leading-relaxed text-fg-secondary">{{ formatPayload(entry.payload) }}</pre>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { IconBug, IconTrash, IconSearch, IconChevronRight, IconCopy } from '@tabler/icons-vue';
import { UiButton, UiBadge, UiInput, UiSelect, UiEmpty } from '../ui/index';
import { useToast } from '../ui/toast';
import { buildApiUrl } from '../config';
import { authFetch } from '../composables/useAuth';
import { readManagementJsonResponse } from '../management-response.js';
import {
    openAuthenticatedEventStream,
    type AuthenticatedEventStream,
} from '../authenticated-event-stream.js';

interface DebugEntry {
    seq: number;
    time: number;
    direction: 'inbound' | 'outbound';
    platform: string;
    account_id: string;
    protocol?: string;
    version?: string;
    payload: unknown;
}

/** 前端展示上限，超出后丢弃最旧的条目，避免长时间运行内存增长 */
const MAX_ENTRIES = 300;

const { success: toastSuccess } = useToast();

const entries = ref<DebugEntry[]>([]);
const expanded = reactive(new Set<number>());
const isConnected = ref(false);
const autoScroll = ref(true);
const listContainer = ref<HTMLElement>();

const platformFilter = ref<string | undefined>(undefined);
const directionFilter = ref<string | undefined>(undefined);
const searchKeyword = ref('');

let eventSource: AuthenticatedEventStream | null = null;

const platformOptions = computed(() => {
    const platforms = [...new Set(entries.value.map(e => e.platform))].sort();
    return [{ label: '全部平台', value: '' }, ...platforms.map(p => ({ label: p, value: p }))];
});

const directionOptions = [
    { label: '全部方向', value: '' },
    { label: '收到', value: 'inbound' },
    { label: '下发', value: 'outbound' },
];

const filteredEntries = computed(() => {
    const keyword = searchKeyword.value.trim().toLowerCase();
    return entries.value.filter(entry => {
        if (platformFilter.value && entry.platform !== platformFilter.value) return false;
        if (directionFilter.value && entry.direction !== directionFilter.value) return false;
        if (keyword) {
            const haystack = `${entry.account_id} ${JSON.stringify(entry.payload)}`.toLowerCase();
            if (!haystack.includes(keyword)) return false;
        }
        return true;
    });
});

function formatTime(ms: number): string {
    const d = new Date(ms);
    return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function formatPayload(payload: unknown): string {
    if (typeof payload === 'string') {
        try {
            return JSON.stringify(JSON.parse(payload), null, 2);
        } catch {
            return payload;
        }
    }
    return JSON.stringify(payload, null, 2);
}

function toggleExpanded(seq: number) {
    if (expanded.has(seq)) expanded.delete(seq);
    else expanded.add(seq);
}

async function copyPayload(entry: DebugEntry) {
    await navigator.clipboard.writeText(formatPayload(entry.payload));
    toastSuccess('已复制到剪贴板');
}

function pushEntry(entry: DebugEntry) {
    entries.value.push(entry);
    if (entries.value.length > MAX_ENTRIES) {
        const removed = entries.value.shift();
        if (removed) expanded.delete(removed.seq);
    }
    if (autoScroll.value) {
        nextTick(() => {
            if (listContainer.value) {
                listContainer.value.scrollTop = listContainer.value.scrollHeight;
            }
        });
    }
}

const clearEntries = async () => {
    entries.value = [];
    expanded.clear();
    try {
        await authFetch(buildApiUrl('/api/message-debug/clear'), { method: 'POST' });
    } catch (error) {
        console.error('清空消息调试记录失败:', error);
    }
};

async function loadHistory() {
    try {
        const response = await authFetch(buildApiUrl('/api/message-debug/history'));
        if (response.ok) {
            entries.value = (await readManagementJsonResponse(response)) as DebugEntry[];
        }
    } catch (error) {
        console.error('获取消息调试历史失败:', error);
    }
}

function connectSSE() {
    eventSource?.close();
    eventSource = openAuthenticatedEventStream(buildApiUrl('/api/message-debug/stream'), {
        onOpen: () => {
            isConnected.value = true;
        },
        onMessage(data) {
            try {
                pushEntry(JSON.parse(data));
            } catch (error) {
                console.error('解析消息调试数据失败:', error);
            }
        },
        onError: error => {
            isConnected.value = false;
            console.error('消息调试 SSE 连接错误:', error);
        },
        retryMs: 3_000,
    });
}

onMounted(async () => {
    await loadHistory();
    connectSSE();
    nextTick(() => {
        if (listContainer.value) {
            listContainer.value.scrollTop = listContainer.value.scrollHeight;
        }
    });
});

onUnmounted(() => {
    eventSource?.close();
});
</script>
