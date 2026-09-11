<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { IconRefresh, IconTerminal2, IconTrash } from "@tabler/icons-vue";
import "@xterm/xterm/css/xterm.css";
import UiButton from "../ui/UiButton.vue";
import {
    parseTerminalServerMessage,
    parseTerminalStatus,
    parseTerminalTicket,
    terminalWebSocketUrl,
} from "../terminal-protocol.js";

const props = defineProps<{
    token: string;
    managerId?: string;
    managerVersion?: string;
    active: boolean;
}>();

type ConnectionState = "checking" | "connecting" | "ready" | "unavailable" | "closed" | "error";
const container = ref<HTMLElement>();
const state = ref<ConnectionState>("checking");
const detail = ref("正在检查本机终端组件");
const cwd = ref("");
const activeSessions = ref(0);
let terminal: Terminal | undefined;
let fit: FitAddon | undefined;
let socket: WebSocket | undefined;
let requestRevision = 0;
let identityAccepted = false;
let disposed = false;

const stateLabel: Record<ConnectionState, string> = {
    checking: "检查中",
    connecting: "连接中",
    ready: "已连接",
    unavailable: "当前不可用",
    closed: "已断开",
    error: "连接失败",
};

function headers(): HeadersInit {
    return { Authorization: `Bearer ${props.token}` };
}

async function connect() {
    disconnect();
    const revision = ++requestRevision;
    state.value = "checking";
    detail.value = "正在确认本机终端是否可用";
    try {
        if (!props.managerId || !props.managerVersion)
            throw new Error("管理服务状态尚未就绪，请稍后重试");
        const statusResponse = await fetch("/api/control/terminal/status", {
            headers: headers(),
            cache: "no-store",
        });
        if (!statusResponse.ok)
            throw new Error(`终端状态检查失败（HTTP ${statusResponse.status}）`);
        const status = parseTerminalStatus(await statusResponse.json());
        if (revision !== requestRevision || !props.active) return;
        activeSessions.value = status.activeSessions;
        if (!status.available) {
            state.value = "unavailable";
            detail.value =
                "本地终端只在服务所在设备开放，请在本机访问并运行 onebots doctor 检查组件。";
            return;
        }
        state.value = "connecting";
        detail.value = "正在创建独立终端会话";
        const ticketResponse = await fetch("/api/control/terminal/ticket", {
            method: "POST",
            headers: headers(),
        });
        if (!ticketResponse.ok)
            throw new Error(`无法创建终端会话（HTTP ${ticketResponse.status}）`);
        const ticket = parseTerminalTicket(await ticketResponse.json());
        if (revision !== requestRevision || !props.active) return;
        openSocket(ticket.ticket, revision);
    } catch (error) {
        if (revision !== requestRevision) return;
        state.value = "error";
        detail.value = error instanceof Error ? error.message : "终端连接失败";
    }
}

function openSocket(ticket: string, revision: number) {
    identityAccepted = false;
    const next = new WebSocket(terminalWebSocketUrl(ticket, window.location));
    socket = next;
    next.onmessage = event => {
        if (revision !== requestRevision || next !== socket) return;
        try {
            const message = parseTerminalServerMessage(JSON.parse(String(event.data)));
            if (message.type === "identity") {
                if (
                    message.instanceId !== props.managerId ||
                    message.version !== props.managerVersion
                ) {
                    throw new Error("终端连接到了另一管理服务实例，请刷新页面后重试");
                }
                identityAccepted = true;
                cwd.value = message.cwd;
                return;
            }
            if (!identityAccepted) throw new Error("终端尚未确认管理服务身份");
            if (message.type === "ready") {
                state.value = "ready";
                detail.value = "独占会话已建立，离开此页面会自动关闭";
                resize();
            } else if (message.type === "output") terminal?.write(message.data);
            else if (message.type === "exit") {
                terminal?.writeln(`\r\n[进程已退出：${message.exitCode}]`);
                state.value = "closed";
                detail.value = "终端进程已退出，可重新连接";
            } else {
                terminal?.writeln(`\r\n[${message.message}]`);
                state.value = "error";
                detail.value = message.message;
            }
        } catch (error) {
            state.value = "error";
            detail.value = error instanceof Error ? error.message : "终端消息验证失败";
            next.close();
        }
    };
    next.onerror = () => {
        if (next === socket) {
            state.value = "error";
            detail.value = "终端 WebSocket 连接失败";
        }
    };
    next.onclose = () => {
        if (next !== socket) return;
        socket = undefined;
        identityAccepted = false;
        if (state.value === "ready" || state.value === "connecting") {
            state.value = "closed";
            detail.value = "连接已关闭，可手动重新连接";
        }
    };
}

function send(payload: unknown) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function resize() {
    fit?.fit();
    if (terminal && state.value === "ready")
        send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
}

function disconnect() {
    requestRevision += 1;
    identityAccepted = false;
    const current = socket;
    socket = undefined;
    current?.close();
}

function clearTerminal() {
    terminal?.clear();
}

async function initializeTerminal() {
    if (terminal || !container.value) return;
    const [{ Terminal: XtermTerminal }, { FitAddon: XtermFitAddon }, { WebLinksAddon }] =
        await Promise.all([
            import("@xterm/xterm"),
            import("@xterm/addon-fit"),
            import("@xterm/addon-web-links"),
        ]);
    if (disposed || terminal || !container.value) return;
    terminal = new XtermTerminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: '\"Geist Mono Variable\", ui-monospace, monospace',
        fontSize: 13,
        lineHeight: 1.35,
        scrollback: 5_000,
        theme: { background: "#101412", foreground: "#cad5cd", cursor: "#65bd91" },
    });
    fit = new XtermFitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container.value);
    terminal.onData(data => {
        if (state.value === "ready") send({ type: "input", data });
    });
}

watch(
    () => props.active,
    async active => {
        if (!active) {
            disconnect();
            state.value = "closed";
            detail.value = "离开页面后连接已关闭";
            return;
        }
        await nextTick();
        await initializeTerminal();
        if (!props.active) return;
        resize();
        void connect();
    },
);

onMounted(() => {
    window.addEventListener("resize", resize);
    if (props.active) {
        void initializeTerminal().then(() => {
            if (!props.active || disposed) return;
            resize();
            void connect();
        });
    }
});

onUnmounted(() => {
    disposed = true;
    disconnect();
    window.removeEventListener("resize", resize);
    terminal?.dispose();
});
</script>

<template>
    <section class="workspace-view terminal-workspace" aria-labelledby="terminal-title">
        <header class="page-heading">
            <div>
                <h1 id="terminal-title">本地终端</h1>
                <p>在 OneBots 工作区中运行维护命令。每次进入页面都会创建新的独占会话。</p>
            </div>
            <span class="terminal-state" :class="state"><i></i>{{ stateLabel[state] }}</span>
        </header>
        <div class="terminal-toolbar">
            <div>
                <IconTerminal2 :size="18" aria-hidden="true" />
                <span
                    ><strong>{{ cwd || "OneBots 工作区" }}</strong
                    ><small>{{ detail }}</small></span
                >
            </div>
            <span v-if="activeSessions" class="terminal-session-count">
                当前 {{ activeSessions }} 个会话
            </span>
            <UiButton
                size="sm"
                :disabled="state === 'checking' || state === 'connecting'"
                @click="connect">
                <IconRefresh :size="15" aria-hidden="true" />重新连接
            </UiButton>
            <UiButton size="sm" variant="ghost" @click="clearTerminal">
                <IconTrash :size="15" aria-hidden="true" />清空
            </UiButton>
        </div>
        <div class="terminal-frame" :class="{ disabled: state === 'unavailable' }">
            <div ref="container" class="terminal-canvas"></div>
            <div v-if="state === 'unavailable'" class="terminal-unavailable">
                <strong>本地终端不可用</strong>
                <p>{{ detail }}</p>
                <code>onebots doctor</code>
            </div>
        </div>
        <p class="terminal-safety">
            终端直接操作本机工作区，请只运行你理解的命令。关闭页面或切换工作区会终止 shell。
        </p>
    </section>
</template>
