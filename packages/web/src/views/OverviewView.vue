<script setup lang="ts">
import { computed } from "vue";
import type { ControlOperation, ControlStatus } from "@onebots/core/control";
import { IconAlertTriangle, IconChevronRight } from "@tabler/icons-vue";
import type { Workspace } from "../control-workspace.js";
import type { ControlMutationBlock, WorkspaceReadiness } from "../control-product-state.js";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{
    state?: ControlStatus;
    busy: boolean;
    lastUpdated?: Date;
    stale: boolean;
    readiness: WorkspaceReadiness;
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
</script>

<template>
    <section class="workspace-view" aria-labelledby="overview-title">
        <header class="page-heading">
            <div>
                <p class="eyebrow">CONTROL PLANE</p>
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
            <section class="runtime-hero" :class="`is-${state.gateway.actual}`">
                <div class="runtime-copy">
                    <p class="runtime-kicker">
                        <span class="status-dot" :class="state.gateway.actual"></span> GATEWAY
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
                        @click="emit('command', 'start')"
                        >启动网关</UiButton
                    >
                    <UiButton
                        :loading="busy"
                        :disabled="!!mutationBlock || state.gateway.actual === 'stopped'"
                        @click="emit('command', 'stop')"
                        >停止</UiButton
                    >
                    <UiButton
                        variant="ghost"
                        :loading="busy"
                        :disabled="!!mutationBlock"
                        @click="emit('command', 'restart')"
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
                v-if="state.gateway.recoveryRequired"
                class="feedback feedback-error recovery-block">
                <IconAlertTriangle :size="20" /><span
                    ><strong>网关需要人工恢复</strong
                    >请先查看最近操作与服务日志，确认上一操作结果后再继续。</span
                >
                <button type="button" @click="emit('select', 'activity')">查看诊断</button>
            </div>
            <div v-else-if="state.gateway.error" class="feedback feedback-error">
                <IconAlertTriangle :size="18" /><span>{{ state.gateway.error }}</span>
            </div>
            <section v-if="readiness === 'empty'" class="onboarding">
                <div class="onboarding-intro">
                    <span>01</span>
                    <div>
                        <p class="eyebrow">EMPTY WORKSPACE</p>
                        <h2>从空白工作区开始</h2>
                        <p>
                            先选择平台与协议，再填写账号配置，最后启动网关。控制台不会替你启用任何外部连接。
                        </p>
                    </div>
                </div>
                <ol class="onboarding-steps">
                    <li>
                        <span>1</span>
                        <div>
                            <strong>安装扩展</strong>
                            <p>选择平台适配器与协议出口，生成不可变运行版本。</p>
                        </div>
                    </li>
                    <li>
                        <span>2</span>
                        <div>
                            <strong>配置账号</strong>
                            <p>创建配置草稿，校验后应用到当前工作区。</p>
                        </div>
                    </li>
                    <li>
                        <span>3</span>
                        <div>
                            <strong>启动网关</strong>
                            <p>启动后在诊断区完成登录验证并观察日志。</p>
                        </div>
                    </li>
                </ol>
                <UiButton variant="primary" @click="emit('select', 'extensions')"
                    >开始安装与配置 <IconChevronRight :size="16"
                /></UiButton>
            </section>
            <div class="overview-grid">
                <section class="account-strip">
                    <div class="section-heading">
                        <div>
                            <p class="eyebrow">ACCOUNTS</p>
                            <h2>账号连接</h2>
                        </div>
                        <button type="button" @click="emit('select', 'configuration')">
                            管理配置 <IconChevronRight :size="15" />
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
                            <p class="eyebrow">ACTIVITY</p>
                            <h2>最近操作</h2>
                        </div>
                        <button type="button" @click="emit('select', 'activity')">
                            打开诊断 <IconChevronRight :size="15" />
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
