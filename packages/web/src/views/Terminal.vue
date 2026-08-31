<template>
    <div class="mx-auto flex h-full w-full max-w-[1400px] flex-col px-4 py-4 sm:px-6 sm:py-6">
        <!-- 工具栏 -->
        <header class="mb-4 flex items-center justify-between gap-4">
            <h2 class="flex items-center gap-2 text-xl font-semibold text-fg">
                <IconTerminal2 :size="22" class="text-fg-secondary" />
                Web 控制台
            </h2>
            <div class="flex items-center gap-2">
                <UiBadge :variant="isConnected ? 'success' : 'danger'" dot>
                    {{ isConnected ? '已连接' : '未连接' }}
                </UiBadge>
                <UiButton v-if="!isConnected" variant="primary" size="sm" @click="reconnect">
                    <IconRefresh :size="14" />
                    重新连接
                </UiButton>
                <UiButton variant="secondary" size="sm" @click="clearTerminal">
                    <IconTrash :size="14" />
                    清空
                </UiButton>
                <UiButton variant="danger" size="sm" @click="restartServer">
                    <IconPower :size="14" />
                    重启服务
                </UiButton>
            </div>
        </header>

        <!-- 交互终端 -->
        <div
            class="min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-surface p-2">
            <div ref="terminalContainer" class="h-full w-full overflow-hidden rounded-control"></div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { IconTerminal2, IconTrash, IconRefresh, IconPower } from '@tabler/icons-vue';
import '@xterm/xterm/css/xterm.css';
import { UiButton, UiBadge } from '../ui/index';
import { buildWsUrl } from '../config';
import { appendWebSocketAuthQuery } from '../composables/useAuth';

const terminalContainer = ref<HTMLElement>();
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
const isConnected = ref(false);

const clearTerminal = () => {
    terminal?.clear();
};

const reconnect = () => {
    connectWebSocket();
};

const connectWebSocket = () => {
    if (ws) {
        ws.close();
    }

    ws = new WebSocket(appendWebSocketAuthQuery(buildWsUrl('/api/terminal')));

    ws.onopen = () => {
        isConnected.value = true;
        console.log('终端已连接');
    };

    ws.onmessage = event => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'output' && terminal) {
                terminal.write(data.data);
            } else if (data.type === 'exit') {
                terminal?.writeln('\r\n\x1b[31m[终端已退出]\x1b[0m');
                isConnected.value = false;
            }
        } catch (error) {
            console.error('解析终端数据失败:', error);
        }
    };

    ws.onerror = error => {
        console.error('WebSocket 错误:', error);
    };

    ws.onclose = () => {
        isConnected.value = false;
        console.log('终端连接已关闭');
        setTimeout(reconnect, 3000);
    };
};

const restartServer = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'restart' }));
        terminal?.writeln('\r\n\x1b[33m[服务重启指令已发送]\x1b[0m');
    }
};

const handleResize = () => {
    fitAddon?.fit();
    if (ws && ws.readyState === WebSocket.OPEN && terminal) {
        ws.send(
            JSON.stringify({
                type: 'resize',
                cols: terminal.cols,
                rows: terminal.rows,
            })
        );
    }
};

onMounted(() => {
    if (terminalContainer.value) {
        terminal = new Terminal({
            cursorBlink: true,
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

        terminal.open(terminalContainer.value);
        fitAddon.fit();

        // 监听用户输入
        terminal.onData(data => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data }));
            }
        });

        // 监听终端尺寸变化
        window.addEventListener('resize', handleResize);

        connectWebSocket();
    }
});

onUnmounted(() => {
    window.removeEventListener('resize', handleResize);
    ws?.close();
    terminal?.dispose();
});
</script>
