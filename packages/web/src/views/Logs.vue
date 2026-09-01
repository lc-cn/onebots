<template>
    <div class="mx-auto flex h-full w-full max-w-[1400px] flex-col px-4 py-4 sm:px-6 sm:py-6">
        <!-- 工具栏 -->
        <header class="mb-4 flex flex-col gap-3">
            <!-- 第一行：标题和操作按钮 -->
            <div class="flex items-center justify-between gap-4">
                <h2 class="flex items-center gap-2 text-xl font-semibold text-fg">
                    <IconFileText :size="22" class="text-fg-secondary" />
                    系统日志
                </h2>
                <div class="flex items-center gap-2">
                    <UiBadge :variant="isConnected ? 'success' : 'danger'" dot>
                        {{ isConnected ? '已连接' : '未连接' }}
                    </UiBadge>
                    <UiButton v-if="!isConnected" variant="primary" size="sm" @click="reconnect">
                        <IconRefresh :size="14" />
                        重新连接
                    </UiButton>
                    <UiButton variant="secondary" size="sm" @click="clearLogs">
                        <IconTrash :size="14" />
                        清空
                    </UiButton>
                </div>
            </div>

            <!-- 第二行：搜索和日志级别过滤 -->
            <div class="flex flex-wrap items-center gap-3">
                <div class="relative w-52 shrink-0">
                    <IconSearch
                        :size="14"
                        class="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-fg-tertiary"
                    />
                    <UiInput
                        v-model="searchKeyword"
                        placeholder="搜索日志..."
                        clearable
                        class="[&_input]:pl-8"
                    />
                </div>
                <div class="h-5 w-px bg-border" aria-hidden="true"></div>
                <div class="flex items-center gap-1.5">
                    <button
                        v-for="level in filterLevels"
                        :key="level.name"
                        type="button"
                        class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-150 select-none"
                        :class="
                            enabledLevels[level.name]
                                ? level.activeClass
                                : 'bg-surface-raised text-fg-tertiary opacity-60 hover:opacity-80'
                        "
                        :title="
                            enabledLevels[level.name]
                                ? `点击隐藏 ${level.label} 日志`
                                : `点击显示 ${level.label} 日志`
                        "
                        @click="toggleLevel(level.name)"
                    >
                        {{ level.label }}
                    </button>
                </div>
                <span
                    v-if="logLines.length > 0"
                    class="ml-auto text-xs tabular-nums text-fg-tertiary"
                >
                    {{ displayedCount }}/{{ logLines.length }} 条
                </span>
            </div>
        </header>

        <!-- 日志终端 -->
        <div
            class="min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-surface p-2">
            <div ref="logsContainer" class="h-full w-full overflow-hidden rounded-control"></div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted, onUnmounted } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { IconFileText, IconTrash, IconRefresh, IconSearch } from '@tabler/icons-vue';
import '@xterm/xterm/css/xterm.css';
import { UiButton, UiBadge, UiInput } from '../ui/index';
import { useConfirm } from '../ui/confirm';
import { buildApiUrl } from '../config';
import {
    openAuthenticatedEventStream,
    type AuthenticatedEventStream,
} from '../authenticated-event-stream.js';
import { parseLogStreamIdentity, parseLogStreamMessage } from '../log-stream-management.js';

const { confirm } = useConfirm();

/* ── 常量 ─────────────────────────────────────────────── */

/** 最大保留日志行数 */
const MAX_LOG_LINES = 2000;

/** 去除 ANSI 转义码的正则 */
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

/** 匹配日志级别标签的正则（适配 log4js 输出格式） */
const LEVEL_REGEX = /\[(TRACE|DEBUG|INFO|WARN|ERROR|FATAL|MARK)\]/i;

/** 搜索防抖延迟（毫秒） */
const SEARCH_DEBOUNCE_MS = 250;

/* ── 日志级别过滤配置 ─────────────────────────────────── */

interface FilterLevel {
    name: string;
    label: string;
    activeClass: string;
}

const filterLevels: FilterLevel[] = [
    { name: 'DEBUG', label: 'DEBUG', activeClass: 'bg-info-soft text-info' },
    { name: 'INFO', label: 'INFO', activeClass: 'bg-success-soft text-success' },
    { name: 'WARN', label: 'WARN', activeClass: 'bg-warning-soft text-warning' },
    { name: 'ERROR', label: 'ERROR', activeClass: 'bg-danger-soft text-danger' },
];

/* ── 类型 ─────────────────────────────────────────────── */

interface LogLine {
    /** 原始文本（含 ANSI 转义码），用于终端渲染 */
    raw: string;
    /** 去除 ANSI 转义码的文本，用于搜索匹配 */
    plain: string;
    /** 解析出的日志级别（大写），无法识别时为 null */
    level: string | null;
}

/* ── 状态 ─────────────────────────────────────────────── */

const logsContainer = ref<HTMLElement>();
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let eventSource: AuthenticatedEventStream | null = null;
const isConnected = ref(false);

/** 存储所有原始日志行 */
const logLines = ref<LogLine[]>([]);
/** 当前终端中显示的行数 */
const displayedCount = ref(0);
/** 各级别是否启用 */
const enabledLevels = reactive<Record<string, boolean>>({
    DEBUG: true,
    INFO: true,
    WARN: true,
    ERROR: true,
});
/** 搜索关键字 */
const searchKeyword = ref('');
/** 行缓冲区（处理跨消息的不完整行） */
let lineBuffer = '';
/** 搜索防抖定时器 */
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
/** 标记是否正在批量渲染（防止重入） */
let isRendering = false;
let streamIdentityEstablished = false;

/* ── 日志级别解析 ─────────────────────────────────────── */

function stripAnsi(text: string): string {
    return text.replace(ANSI_REGEX, '');
}

function parseLevel(plain: string): string | null {
    const match = plain.match(LEVEL_REGEX);
    return match ? match[1].toUpperCase() : null;
}

/**
 * 将解析到的日志级别映射到过滤按钮。
 * TRACE 归入 DEBUG，FATAL 归入 ERROR，MARK 始终显示。
 */
function mapLevelToFilter(level: string): string | null {
    switch (level) {
        case 'TRACE':
        case 'DEBUG':
            return 'DEBUG';
        case 'INFO':
            return 'INFO';
        case 'WARN':
            return 'WARN';
        case 'ERROR':
        case 'FATAL':
            return 'ERROR';
        default:
            return null;
    }
}

/* ── 过滤逻辑 ─────────────────────────────────────────── */

function shouldShowLine(line: LogLine): boolean {
    // 级别过滤：有已识别级别时按对应按钮的启用状态过滤
    if (line.level) {
        const filterKey = mapLevelToFilter(line.level);
        if (filterKey && !enabledLevels[filterKey]) {
            return false;
        }
    }

    // 关键字搜索（大小写不敏感）
    const keyword = searchKeyword.value.trim();
    if (keyword) {
        return line.plain.toLowerCase().includes(keyword.toLowerCase());
    }

    return true;
}

function toggleLevel(level: string) {
    enabledLevels[level] = !enabledLevels[level];
}

/* ── 终端渲染 ─────────────────────────────────────────── */

/** 清空终端并按当前过滤条件重新渲染所有日志行 */
function renderFilteredLogs() {
    if (!terminal || isRendering) return;
    isRendering = true;

    terminal.reset();

    const lines = logLines.value;
    let count = 0;

    for (const line of lines) {
        if (shouldShowLine(line)) {
            terminal.writeln(line.raw);
            count++;
        }
    }

    displayedCount.value = count;
    isRendering = false;
}

/* ── 日志行处理 ────────────────────────────────────────── */

function createLogLine(raw: string): LogLine {
    const plain = stripAnsi(raw);
    const level = parseLevel(plain);
    return { raw, plain, level };
}

function addLogLine(raw: string) {
    const line = createLogLine(raw);
    logLines.value.push(line);

    // 超出最大行数时移除最早的行
    if (logLines.value.length > MAX_LOG_LINES) {
        const removed = logLines.value.shift()!;
        if (shouldShowLine(removed)) {
            displayedCount.value--;
        }
    }

    // 匹配当前过滤条件时直接追加到终端
    if (shouldShowLine(line) && terminal && !isRendering) {
        terminal.writeln(line.raw);
        displayedCount.value++;
    }
}

/** 将 SSE 消息拆分为独立日志行并逐条处理 */
function processMessage(message: string) {
    const combined = lineBuffer + message;
    const parts = combined.split('\r\n');

    // 最后一部分可能是不完整的行，暂存到缓冲区
    lineBuffer = parts.pop() || '';

    for (const part of parts) {
        if (part.length > 0) {
            addLogLine(part);
        }
    }
}

function resetLogView() {
    logLines.value = [];
    lineBuffer = '';
    displayedCount.value = 0;
    terminal?.reset();
}

/* ── 连接与控制 ────────────────────────────────────────── */

const handleResize = () => {
    fitAddon?.fit();
};

const clearLogs = async () => {
    const confirmed = await confirm({
        title: '清空日志',
        message: '确认清空当前日志输出？该操作仅清除显示内容，不影响服务端日志文件。',
        confirmText: '清空',
        danger: true,
    });
    if (!confirmed) return;
    resetLogView();
};

const reconnect = () => {
    connectSSE();
};

const connectSSE = () => {
    if (eventSource) {
        eventSource.close();
    }

    // 重连时清空（服务端会重新发送缓存日志）
    resetLogView();

    eventSource = openAuthenticatedEventStream(buildApiUrl('/api/logs'), {
        onOpen: () => {
            isConnected.value = true;
            streamIdentityEstablished = false;
            console.log('日志流已连接');
        },
        onMessage(eventData) {
            try {
                const payload: unknown = JSON.parse(eventData);
                const identity = parseLogStreamIdentity(payload);
                if (identity) {
                    streamIdentityEstablished = true;
                    resetLogView();
                    return;
                }
                if (!streamIdentityEstablished) {
                    throw new Error('日志事件流尚未声明实例身份');
                }
                processMessage(parseLogStreamMessage(payload));
            } catch (error) {
                console.error('解析日志数据失败:', error);
            }
        },
        onError: error => {
            isConnected.value = false;
            console.error('SSE 连接错误:', error);
        },
        retryMs: 3_000,
    });
};

/* ── 监听过滤器变化 ────────────────────────────────────── */

// 日志级别变化时立即重新渲染
watch(enabledLevels, () => {
    renderFilteredLogs();
});

// 搜索关键字变化时防抖重新渲染
watch(searchKeyword, () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        renderFilteredLogs();
    }, SEARCH_DEBOUNCE_MS);
});

/* ── 生命周期 ──────────────────────────────────────────── */

onMounted(() => {
    if (logsContainer.value) {
        terminal = new Terminal({
            disableStdin: true,
            cursorBlink: false,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
                background: '#141619',
                foreground: '#e4e4e7',
            },
        });

        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(new WebLinksAddon());

        terminal.open(logsContainer.value);
        fitAddon.fit();

        window.addEventListener('resize', handleResize);

        connectSSE();
    }
});

onUnmounted(() => {
    window.removeEventListener('resize', handleResize);
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    eventSource?.close();
    terminal?.dispose();
});
</script>
