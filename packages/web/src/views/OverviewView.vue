<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { ControlOperation, ControlStatus } from "@onebots/core/control";
import { IconAlertTriangle, IconChevronRight } from "@tabler/icons-vue";
import ControlSetupJourney from "../components/ControlSetupJourney.vue";
import type { Workspace } from "../control-workspace.js";
import type { ControlMutationBlock, SetupJourney } from "../control-product-state.js";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{
    state?: ControlStatus;
    busy: boolean;
    lastUpdated?: Date;
    stale: boolean;
    journey: SetupJourney;
    mutationBlock?: ControlMutationBlock;
}>();
const emit = defineEmits<{
    command: [action: "start" | "stop" | "restart"];
    select: [workspace: Workspace];
}>();
const stateLabels: Record<ControlStatus["gateway"]["actual"], string> = {
    starting: "正在启动",
    running: "运行中",
    stopping: "正在停止",
    stopped: "已停止",
    failed: "需要修复",
};
const operationLabels: Record<ControlOperation["action"], string> = {
    start: "启动网关",
    stop: "停止网关",
    restart: "重启网关",
    shutdown: "退出管理服务",
    reconcile: "恢复核验",
    suspend: "切换运行版本",
};
const operationStatusLabels: Record<ControlOperation["status"], string> = {
    running: "处理中",
    succeeded: "已完成",
    failed: "失败",
};
const accountItems = computed(() => props.state?.accounts?.items ?? []);
const onlineAccounts = computed(
    () => accountItems.value.filter(account => account.status === "online").length,
);
const recentOperations = computed(() =>
    [...(props.state?.gateway.operations ?? [])].reverse().slice(0, 6),
);
const pendingCommand = ref<"stop" | "restart">();
const commandDialog = ref<HTMLElement>();
const runtimeStatus = ref<HTMLElement>();
let commandTrigger: HTMLElement | null = null;
const commandImpact = computed(() => {
    if (pendingCommand.value === "stop")
        return {
            title: "停止网关？",
            detail: "平台账号会断开，所有协议出口将停止响应，直到你再次启动网关。管理控制台仍会保持在线。",
            confirm: "确认停止",
        };
    return {
        title: "重启网关？",
        detail: "平台账号和协议连接会短暂中断并重新建立。当前网关进程会退出，新的实例标识与进程号将发生变化。",
        confirm: "确认重启",
    };
});

function requestCommand(action: "start" | "stop" | "restart") {
    if (action === "start") emit("command", action);
    else {
        commandTrigger =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        pendingCommand.value = action;
        void nextTick(() =>
            commandDialog.value?.querySelector<HTMLButtonElement>("button")?.focus(),
        );
    }
}

function closeCommand() {
    pendingCommand.value = undefined;
    void nextTick(restoreCommandFocus);
}

function confirmCommand() {
    const action = pendingCommand.value;
    pendingCommand.value = undefined;
    if (action) emit("command", action);
    void nextTick(restoreCommandFocus);
}

function restoreCommandFocus() {
    if (commandTrigger && !commandTrigger.matches(":disabled")) commandTrigger.focus();
    else runtimeStatus.value?.focus();
}

function keepCommandFocus(event: KeyboardEvent) {
    if (event.key === "Escape") {
        event.preventDefault();
        closeCommand();
        return;
    }
    if (event.key !== "Tab" || !commandDialog.value) return;
    const controls = [
        ...commandDialog.value.querySelectorAll<HTMLElement>("button:not(:disabled)"),
    ];
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}
</script>

<template>
    <section class="workspace-view" aria-labelledby="overview-title">
        <header class="page-heading">
            <div>
                <h1 id="overview-title">运行概览</h1>
                <p>管理网关生命周期，并确认账号连接状态。</p>
            </div>
            <span class="manager-identity" :class="{ stale }" :title="state?.manager.id">
                {{ stale ? "缓存状态" : "状态更新" }}
                {{
                    lastUpdated?.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                    }) ?? "—"
                }}
            </span>
        </header>
        <div v-if="!state" class="overview-skeleton" aria-label="正在连接管理服务">
            <div class="skeleton skeleton-hero"></div>
            <div class="skeleton"></div>
            <div class="skeleton"></div>
        </div>
        <template v-else>
            <div class="overview-primary" :class="{ 'has-journey': journey.state !== 'running' }">
                <section
                    ref="runtimeStatus"
                    class="runtime-hero"
                    tabindex="-1"
                    :class="`is-${state.gateway.actual}`">
                    <div class="runtime-copy">
                        <p class="runtime-kicker">
                            <span class="status-dot" :class="state.gateway.actual"></span> 网关状态
                        </p>
                        <h2>{{ stateLabels[state.gateway.actual] }}</h2>
                        <p>
                            网关期望保持{{ state.gateway.desired === "running" ? "运行" : "停止" }}
                            <template v-if="state.gateway.instance?.id">
                                · 实例 {{ state.gateway.instance.id.slice(0, 8) }}</template
                            >
                        </p>
                    </div>
                    <div class="runtime-actions">
                        <UiButton
                            variant="primary"
                            :loading="busy"
                            :disabled="!!mutationBlock || state.gateway.actual === 'running'"
                            @click="requestCommand('start')"
                            >启动网关</UiButton
                        >
                        <UiButton
                            :loading="busy"
                            :disabled="!!mutationBlock || state.gateway.actual === 'stopped'"
                            @click="requestCommand('stop')"
                            >停止</UiButton
                        >
                        <UiButton
                            variant="ghost"
                            :loading="busy"
                            :disabled="!!mutationBlock"
                            @click="requestCommand('restart')"
                            >重启</UiButton
                        >
                    </div>
                    <div class="runtime-metrics">
                        <div>
                            <span>账号</span><strong>{{ accountItems.length }}</strong>
                        </div>
                        <div>
                            <span>在线</span><strong>{{ onlineAccounts }}</strong>
                        </div>
                        <div>
                            <span>管理进程</span><strong>{{ state.manager.pid ?? "—" }}</strong>
                        </div>
                    </div>
                </section>
                <div
                    v-if="pendingCommand"
                    class="command-confirm-backdrop"
                    role="presentation"
                    @click.self="closeCommand">
                    <section
                        ref="commandDialog"
                        class="command-confirm"
                        role="dialog"
                        tabindex="-1"
                        aria-modal="true"
                        aria-labelledby="command-confirm-title"
                        aria-describedby="command-confirm-detail"
                        @keydown="keepCommandFocus">
                        <div class="command-confirm-icon">
                            <IconAlertTriangle :size="22" aria-hidden="true" />
                        </div>
                        <div>
                            <h2 id="command-confirm-title">{{ commandImpact.title }}</h2>
                            <p id="command-confirm-detail">{{ commandImpact.detail }}</p>
                            <p v-if="accountItems.length" class="command-confirm-count">
                                当前涉及 {{ accountItems.length }} 个账号，其中 {{ onlineAccounts }}
                                个在线。
                            </p>
                        </div>
                        <div class="command-confirm-actions">
                            <UiButton @click="closeCommand">取消</UiButton>
                            <UiButton variant="danger" @click="confirmCommand">{{
                                commandImpact.confirm
                            }}</UiButton>
                        </div>
                    </section>
                </div>
                <div
                    v-if="state.gateway.recoveryRequired"
                    class="feedback feedback-error recovery-block">
                    <IconAlertTriangle :size="20" aria-hidden="true" /><span
                        ><strong>网关需要人工恢复</strong
                        >请先查看最近操作与服务日志，确认上一操作结果后再继续。</span
                    >
                    <button type="button" @click="emit('select', 'activity')">查看诊断</button>
                </div>
                <div v-else-if="state.gateway.error" class="feedback feedback-error">
                    <IconAlertTriangle :size="18" aria-hidden="true" /><span>{{
                        state.gateway.error
                    }}</span>
                </div>
                <ControlSetupJourney
                    v-if="journey.state !== 'running'"
                    :journey="journey"
                    @select="emit('select', $event)" />
            </div>
            <div class="overview-grid">
                <section class="account-strip">
                    <div class="section-heading">
                        <div>
                            <h2>账号连接</h2>
                        </div>
                        <button type="button" @click="emit('select', 'configuration')">
                            管理配置 <IconChevronRight :size="15" aria-hidden="true" />
                        </button>
                    </div>
                    <p v-if="state.accounts?.available === false" class="empty-copy">
                        网关未提供账号摘要。启动网关后可查看运行状态。
                    </p>
                    <p v-else-if="!accountItems.length" class="empty-copy">尚未配置平台账号。</p>
                    <ul v-else class="account-list">
                        <li
                            v-for="account in accountItems"
                            :key="`${account.platform}:${account.accountId}`">
                            <span class="account-icon">{{
                                account.platform.slice(0, 2).toUpperCase()
                            }}</span>
                            <span
                                ><strong>{{ account.accountId }}</strong
                                ><small>{{ account.platform }}</small></span
                            >
                            <em :class="account.status">{{
                                { online: "在线", offline: "离线", pending: "连接中" }[
                                    account.status
                                ]
                            }}</em>
                        </li>
                    </ul>
                </section>
                <section class="operation-timeline">
                    <div class="section-heading">
                        <div>
                            <h2>最近操作</h2>
                        </div>
                        <button type="button" @click="emit('select', 'activity')">
                            打开诊断 <IconChevronRight :size="15" aria-hidden="true" />
                        </button>
                    </div>
                    <p v-if="!recentOperations.length" class="empty-copy">还没有网关操作记录。</p>
                    <ol v-else>
                        <li v-for="operation in recentOperations" :key="operation.id">
                            <span class="timeline-mark" :class="operation.status"></span>
                            <div>
                                <strong>{{ operationLabels[operation.action] }}</strong
                                ><small>{{ new Date(operation.startedAt).toLocaleString() }}</small>
                            </div>
                            <em :class="operation.status">{{
                                operationStatusLabels[operation.status]
                            }}</em>
                        </li>
                    </ol>
                </section>
            </div>
        </template>
    </section>
</template>

<style scoped>
.command-confirm-backdrop {
    position: fixed;
    z-index: 60;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 1.25rem;
    background: rgb(0 0 0 / 48%);
    backdrop-filter: blur(3px);
}

.command-confirm {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 1rem;
    width: min(100%, 34rem);
    padding: 1.25rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow);
}

.command-confirm-icon {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    color: var(--danger);
    background: var(--danger-soft);
}

.command-confirm h2 {
    margin: 0 0 0.45rem;
    font-size: 1.1rem;
}

.command-confirm p {
    margin: 0;
    color: var(--fg-secondary);
    line-height: 1.55;
}

.command-confirm .command-confirm-count {
    margin-top: 0.75rem;
    color: var(--fg);
    font-weight: 600;
}

.command-confirm-actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: 0.65rem;
    padding-top: 0.25rem;
}
</style>
