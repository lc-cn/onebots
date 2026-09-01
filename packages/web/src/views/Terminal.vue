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
                <UiButton
                    variant="danger"
                    size="sm"
                    :disabled="!isConnected"
                    @click="restartServer">
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
import { buildApiUrl, buildWsUrl } from '../config';
import { appendWebSocketAuthQuery, authFetch } from '../composables/useAuth';
import {
    TerminalWebSocketConnection,
    shouldReconnectTerminalWebSocket,
} from '../terminal-websocket-connection';
import {
    assertTerminalInstanceMatches,
    parseTerminalInstanceIdentity,
    readTerminalTargetIdentity,
} from '../terminal-instance.js';
import type { ManagementEvidenceIdentity } from '../management-evidence-identity.js';

const terminalContainer = ref<HTMLElement>();
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let connection: TerminalWebSocketConnection | null = null;
const isConnected = ref(false);
let expectedIdentity: ManagementEvidenceIdentity | null = null;
let terminalIdentityEstablished = false;
let connectionAttemptGeneration = 0;

const clearTerminal = () => {
    terminal?.clear();
};

const reconnect = () => {
    void connectWebSocket();
};

const connectWebSocket = async () => {
    const generation = ++connectionAttemptGeneration;
    try {
        const response = await authFetch(buildApiUrl('/api/system'), {
            cache: 'no-store',
            redirect: 'error',
        });
        const targetIdentity = await readTerminalTargetIdentity(response);
        if (generation !== connectionAttemptGeneration) return;
        expectedIdentity = targetIdentity;
    } catch (error) {
        if (generation !== connectionAttemptGeneration) return;
        isConnected.value = false;
        terminal?.writeln(
            `\r\n\x1b[31m[无法确认终端目标实例：${error instanceof Error ? error.message : String(error)}]\x1b[0m`,
        );
        return;
    }

    connection?.dispose();
    terminalIdentityEstablished = false;
    connection = new TerminalWebSocketConnection(
        () => new WebSocket(appendWebSocketAuthQuery(buildWsUrl('/api/terminal'))),
        {
            onConnecting: () => {
                isConnected.value = false;
                terminalIdentityEstablished = false;
            },
            onOpen: () => {
                console.log('终端 WebSocket 已建立，等待实例身份');
            },
            onMessage: event => {
                try {
                    const data: unknown = JSON.parse(event.data);
                    const actualIdentity = parseTerminalInstanceIdentity(data);
                    if (actualIdentity) {
                        if (!expectedIdentity) throw new Error('终端页面缺少目标实例身份');
                        assertTerminalInstanceMatches(expectedIdentity, actualIdentity);
                        terminalIdentityEstablished = true;
                        isConnected.value = true;
                        console.log(`终端已连接到实例 ${actualIdentity.instanceId}`);
                        handleResize();
                        return;
                    }
                    if (!terminalIdentityEstablished || !isRecord(data)) {
                        throw new Error('终端 WebSocket 尚未声明实例身份');
                    }
                    if (data.type === 'output' && terminal) {
                        if (typeof data.data !== 'string') throw new Error('终端输出格式无效');
                        terminal.write(data.data);
                    } else if (data.type === 'exit') {
                        terminal?.writeln('\r\n\x1b[31m[终端已退出]\x1b[0m');
                        isConnected.value = false;
                    } else if (data.type === 'error' && typeof data.message === 'string') {
                        terminal?.writeln(`\r\n\x1b[31m[${data.message}]\x1b[0m`);
                    } else {
                        throw new Error('终端 WebSocket 包含未知事件');
                    }
                } catch (error) {
                    console.error('解析终端数据失败:', error);
                    terminal?.writeln(
                        `\r\n\x1b[31m[终端连接验证失败：${error instanceof Error ? error.message : String(error)}]\x1b[0m`,
                    );
                    terminalIdentityEstablished = false;
                    isConnected.value = false;
                    connection?.disconnect();
                }
            },
            onError: error => {
                console.error('WebSocket 错误:', error);
            },
            onClose: event => {
                isConnected.value = false;
                terminalIdentityEstablished = false;
                console.log('终端连接已关闭');
                if (!shouldReconnectTerminalWebSocket(event)) {
                    terminal?.writeln('\r\n\x1b[31m[管理凭据已失效，请重新登录后手动连接]\x1b[0m');
                }
            },
            shouldReconnect: shouldReconnectTerminalWebSocket,
        }
    );
    connection.connect();
};

const restartServer = () => {
    if (terminalIdentityEstablished && connection?.sendJson({ type: 'restart' })) {
        terminal?.writeln('\r\n\x1b[33m[服务重启指令已发送]\x1b[0m');
    }
};

const handleResize = () => {
    fitAddon?.fit();
    if (terminal && terminalIdentityEstablished) {
        connection?.sendJson({
            type: 'resize',
            cols: terminal.cols,
            rows: terminal.rows,
        });
    }
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
            if (terminalIdentityEstablished) connection?.sendJson({ type: 'input', data });
        });

        // 监听终端尺寸变化
        window.addEventListener('resize', handleResize);

        void connectWebSocket();
    }
});

onUnmounted(() => {
    connectionAttemptGeneration += 1;
    window.removeEventListener('resize', handleResize);
    connection?.dispose();
    connection = null;
    terminal?.dispose();
});
</script>
