<template>
    <div class="mx-auto flex h-full w-full max-w-[1400px] flex-col px-6 py-6">
        <!-- 工具栏 -->
        <header class="mb-4 flex items-center justify-between gap-4">
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
        </header>

        <!-- 日志终端 -->
        <div
            class="min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-surface p-2">
            <div ref="logsContainer" class="h-full w-full overflow-hidden rounded-control"></div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { IconFileText, IconTrash, IconRefresh } from '@tabler/icons-vue';
import '@xterm/xterm/css/xterm.css';
import { UiButton, UiBadge } from '../ui/index';
import { useConfirm } from '../ui/confirm';
import { buildApiUrl } from '../config';
import { appendAuthQuery } from '../composables/useAuth';

const { confirm } = useConfirm();

const logsContainer = ref<HTMLElement>();
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let eventSource: EventSource | null = null;
const isConnected = ref(false);

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
    terminal?.clear();
};

const reconnect = () => {
    connectSSE();
};

const connectSSE = () => {
    if (eventSource) {
        eventSource.close();
    }

    eventSource = new EventSource(appendAuthQuery(buildApiUrl('/api/logs')));

    eventSource.onopen = () => {
        isConnected.value = true;
        console.log('日志流已连接');
    };

    eventSource.onmessage = event => {
        try {
            const data = JSON.parse(event.data);
            if (terminal && data.message) {
                terminal.write(data.message);
            }
        } catch (error) {
            console.error('解析日志数据失败:', error);
        }
    };

    eventSource.onerror = () => {
        isConnected.value = false;
        console.error('SSE 连接错误');
        eventSource?.close();
        setTimeout(reconnect, 3000);
    };
};

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
    eventSource?.close();
    terminal?.dispose();
});
</script>
