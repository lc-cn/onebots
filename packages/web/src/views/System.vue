<template>
    <div class="h-full overflow-y-auto">
        <div class="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
            <!-- 页头 -->
            <header
                class="mb-6 flex items-center justify-between gap-4 border-b border-border pb-4">
                <h2 class="flex items-center gap-2 text-xl font-semibold text-fg">
                    <IconDashboard :size="22" class="text-fg-secondary" />
                    系统信息
                </h2>
                <div class="flex items-center gap-2">
                    <label
                        class="flex cursor-pointer items-center gap-1.5 text-sm text-fg-secondary"
                        title="每 10 秒自动刷新系统信息与服务状态">
                        <UiSwitch v-model="autoRefresh" />
                        <span class="hidden sm:inline">自动刷新</span>
                    </label>
                    <UiButton
                        variant="primary"
                        :loading="backupLoading"
                        :disabled="!systemInfo"
                        @click="handleBackup">
                        <IconUpload v-if="!backupLoading" :size="16" />
                        备份到仓库
                    </UiButton>
                    <UiButton
                        variant="danger"
                        :loading="restartLoading"
                        :disabled="!systemInfo || systemInfo.restartSupported === false"
                        :title="
                            systemInfo?.restartSupported === false
                                ? '当前进程没有自动拉起监督器，请在宿主环境中手动重启'
                                : '重启服务'
                        "
                        @click="handleRestart">
                        <IconRefresh v-if="!restartLoading" :size="16" />
                        重启服务
                    </UiButton>
                </div>
            </header>

            <UiAlert
                v-if="systemSnapshot.status === 'unavailable'"
                variant="danger"
                title="系统快照证据不可用"
                class="mb-6">
                {{ systemSnapshot.error }}。页面不会展示或操作来源不一致的系统信息。
            </UiAlert>

            <!-- 统计卡片 -->
            <div v-if="systemInfo" class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div class="rounded-card border border-border bg-surface p-4">
                    <div class="flex items-center gap-3">
                        <span
                            class="flex size-10 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent">
                            <IconClock :size="20" />
                        </span>
                        <div class="min-w-0">
                            <p class="text-sm text-fg-secondary">运行时长</p>
                            <p class="truncate font-mono text-2xl font-semibold text-fg">
                                {{ formatTime(systemInfo.uptime) }}
                            </p>
                        </div>
                    </div>
                </div>
                <div class="rounded-card border border-border bg-surface p-4">
                    <div class="flex items-center gap-3">
                        <span
                            class="flex size-10 shrink-0 items-center justify-center rounded-control bg-success-soft text-success">
                            <IconCpu :size="20" />
                        </span>
                        <div class="min-w-0">
                            <p class="text-sm text-fg-secondary">进程内存</p>
                            <p class="truncate font-mono text-2xl font-semibold text-fg">
                                {{ formatSize(systemInfo.process_use_memory) }}
                            </p>
                        </div>
                    </div>
                </div>
                <div class="rounded-card border border-border bg-surface p-4">
                    <div class="flex items-center gap-3">
                        <span
                            class="flex size-10 shrink-0 items-center justify-center rounded-control bg-warning-soft text-warning">
                            <IconDatabase :size="20" />
                        </span>
                        <div class="min-w-0 flex-1">
                            <p class="text-sm text-fg-secondary">系统内存</p>
                            <p class="truncate font-mono text-2xl font-semibold text-fg">
                                {{ formatSize(systemInfo.free_memory) }} /
                                {{ formatSize(systemInfo.total_memory) }}
                            </p>
                            <p class="mt-1 text-xs text-fg-tertiary">
                                使用率: {{ memoryUsagePercent }}%
                            </p>
                            <div
                                class="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-raised">
                                <div
                                    class="h-full rounded-full bg-accent"
                                    :style="{ width: memoryUsagePercent + '%' }" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 详细信息 -->
            <UiCard v-if="systemInfo" class="mb-6">
                <template #header>详细信息</template>
                <dl class="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
                    <div class="flex items-baseline gap-3">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">用户名</dt>
                        <dd class="min-w-0 text-fg">{{ systemInfo.username }}</dd>
                    </div>
                    <div class="flex items-baseline gap-3">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">内核</dt>
                        <dd class="min-w-0 text-fg">{{ systemInfo.system_platform }}</dd>
                    </div>
                    <div class="flex items-baseline gap-3">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">架构</dt>
                        <dd class="min-w-0 text-fg">{{ systemInfo.system_arch }}</dd>
                    </div>
                    <div class="flex items-baseline gap-3">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">系统版本</dt>
                        <dd class="min-w-0 text-fg">{{ systemInfo.system_version }}</dd>
                    </div>
                    <div class="flex items-baseline gap-3">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">系统运行时长</dt>
                        <dd class="min-w-0 text-fg">{{ formatTime(systemInfo.system_uptime) }}</dd>
                    </div>
                    <div class="flex items-baseline gap-3">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">Node.js 版本</dt>
                        <dd class="min-w-0 text-fg">{{ systemInfo.node_version }}</dd>
                    </div>
                    <div class="flex items-baseline gap-3 md:col-span-2">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">OneBots 版本</dt>
                        <dd class="min-w-0 text-fg">
                            {{ systemInfo.application_name || "onebots" }} v{{
                                systemInfo.application_version || systemInfo.sdk_version
                            }}
                        </dd>
                    </div>
                    <div class="flex items-baseline gap-3 md:col-span-2">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">Core 版本</dt>
                        <dd class="min-w-0 text-fg">
                            @onebots/core v{{ systemInfo.core_version || systemInfo.sdk_version }}
                        </dd>
                    </div>
                    <div class="flex items-baseline gap-3 md:col-span-2">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">自动重启</dt>
                        <dd>
                            <UiBadge
                                :variant="
                                    systemInfo.restartSupported === true
                                        ? 'success'
                                        : systemInfo.restartSupported === false
                                          ? 'warning'
                                          : 'neutral'
                                ">
                                {{
                                    systemInfo.restartSupported === true
                                        ? "监督器已验证"
                                        : systemInfo.restartSupported === false
                                          ? "需在宿主环境手动重启"
                                          : "当前服务端未声明"
                                }}
                            </UiBadge>
                        </dd>
                    </div>
                    <div class="flex items-baseline gap-3 md:col-span-2">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">运行目录</dt>
                        <dd class="min-w-0 truncate font-mono text-xs text-fg">
                            {{ systemInfo.process_cwd }}
                        </dd>
                    </div>
                    <div
                        v-if="systemInfo.configDir"
                        class="flex items-baseline gap-3 md:col-span-2">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">配置目录</dt>
                        <dd class="flex min-w-0 items-center gap-1.5">
                            <span class="min-w-0 truncate font-mono text-xs text-fg">
                                {{ systemInfo.configDir }}
                            </span>
                            <UiTooltip
                                text="Docker 下请挂载此目录以持久化配置与数据"
                                placement="top">
                                <IconInfoCircle
                                    :size="14"
                                    class="shrink-0 cursor-help text-fg-tertiary" />
                            </UiTooltip>
                        </dd>
                    </div>
                    <div
                        v-if="systemInfo.configPath"
                        class="flex items-baseline gap-3 md:col-span-2">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">配置文件</dt>
                        <dd class="min-w-0 truncate font-mono text-xs text-fg">
                            {{ systemInfo.configPath }}
                        </dd>
                    </div>
                    <div class="flex items-center gap-3 md:col-span-2">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">配置状态</dt>
                        <dd class="flex min-w-0 items-center gap-2">
                            <UiBadge
                                :variant="
                                    systemInfo.configState.status === 'in_sync'
                                        ? 'success'
                                        : 'danger'
                                "
                                dot>
                                {{ configStateLabel }}
                            </UiBadge>
                            <span
                                class="truncate text-xs text-fg-tertiary"
                                :title="systemInfo.configState.message">
                                最近应用 {{ formatAppliedAt(systemInfo.configState.appliedAt) }}
                            </span>
                        </dd>
                    </div>
                    <div v-if="systemInfo.dataDir" class="flex items-baseline gap-3 md:col-span-2">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">数据目录</dt>
                        <dd class="min-w-0 truncate font-mono text-xs text-fg">
                            {{ systemInfo.dataDir }}
                        </dd>
                    </div>
                    <div class="flex items-baseline gap-3">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">进程 ID</dt>
                        <dd class="min-w-0 font-mono text-fg">{{ systemInfo.process_id }}</dd>
                    </div>
                    <div class="flex items-baseline gap-3">
                        <dt class="w-24 shrink-0 text-sm text-fg-secondary">父进程 ID</dt>
                        <dd class="min-w-0 font-mono text-fg">
                            {{ systemInfo.process_parent_id }}
                        </dd>
                    </div>
                </dl>
            </UiCard>

            <UiCard v-if="systemInfo" class="mb-6">
                <template #header>
                    <span class="flex-1">运行时插件</span>
                    <UiBadge variant="neutral">{{ systemInfo.plugins.length }} 个</UiBadge>
                </template>
                <div v-if="systemInfo.plugins.length" class="divide-y divide-border">
                    <div
                        v-for="plugin in systemInfo.plugins"
                        :key="`${plugin.type}:${plugin.name}`"
                        class="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-3">
                        <div class="flex min-w-0 flex-1 items-center gap-2">
                            <UiBadge :variant="plugin.type === 'adapter' ? 'success' : 'neutral'">
                                {{ plugin.type === "adapter" ? "适配器" : "协议" }}
                            </UiBadge>
                            <span class="font-medium text-fg">{{ plugin.name }}</span>
                            <span class="truncate font-mono text-xs text-fg-secondary">
                                {{ plugin.packageName }}@{{ plugin.version ?? "未知版本" }}
                            </span>
                        </div>
                        <span
                            class="max-w-full truncate font-mono text-xs text-fg-tertiary sm:max-w-[45%]"
                            :title="plugin.entryPath">
                            {{ plugin.entryPath }}
                        </span>
                    </div>
                </div>
                <p v-else class="text-sm text-fg-secondary">当前进程未加载适配器或协议插件。</p>
            </UiCard>

            <!-- 服务状态 -->
            <UiCard>
                <template #header>
                    <span class="flex-1">服务状态</span>
                    <UiButton
                        variant="ghost"
                        size="sm"
                        :loading="healthLoading"
                        @click="refreshServiceStatus">
                        <IconRefresh v-if="!healthLoading" :size="14" />
                        刷新
                    </UiButton>
                </template>
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div class="flex items-center gap-2.5">
                        <IconCircleCheckFilled
                            v-if="healthStatus.state === 'success'"
                            :size="20"
                            class="text-success" />
                        <IconInfoCircle
                            v-else-if="healthStatus.state === 'warning'"
                            :size="20"
                            class="text-warning" />
                        <IconCircleXFilled v-else :size="20" class="text-danger" />
                        <span class="flex-1 text-sm text-fg-secondary">/health（存活）</span>
                        <UiBadge :variant="healthStatus.state" :title="healthStatus.detail" dot>
                            {{ healthStatus.label }}
                        </UiBadge>
                    </div>
                    <div class="flex items-center gap-2.5">
                        <IconCircleCheckFilled
                            v-if="readyStatus.state === 'success'"
                            :size="20"
                            class="text-success" />
                        <IconInfoCircle
                            v-else-if="readyStatus.state === 'warning'"
                            :size="20"
                            class="text-warning" />
                        <IconCircleXFilled v-else :size="20" class="text-danger" />
                        <span class="flex-1 text-sm text-fg-secondary">/ready（就绪）</span>
                        <UiBadge :variant="readyStatus.state" :title="readyStatus.detail" dot>
                            {{ readyStatus.label }}
                        </UiBadge>
                    </div>
                </div>
            </UiCard>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import {
    IconDashboard,
    IconClock,
    IconCpu,
    IconDatabase,
    IconInfoCircle,
    IconCircleCheckFilled,
    IconCircleXFilled,
    IconRefresh,
    IconUpload,
} from "@tabler/icons-vue";
import { UiAlert, UiButton, UiCard, UiBadge } from "../ui/index";
import UiSwitch from "../ui/UiSwitch.vue";
import UiTooltip from "../ui/UiTooltip.vue";
import { useToast } from "../ui/toast";
import { useConfirm } from "../ui/confirm";
import { useApi } from "../composables/useApi";
import { authFetch } from "../composables/useAuth";
import { formatSize, formatTime } from "../utils";
import { buildApiUrl } from "../config";
import {
    readCurrentServiceIdentity,
    requestServiceRestart,
    waitForServiceRestart,
} from "../utils/service-restart";
import {
    pendingReadinessProbe,
    probeHealth,
    probeReadiness,
    reconcileServiceProbeInstances,
    type ServiceProbeResult,
} from "../utils/service-probes.js";
import { createSystemDashboardRefreshCoordinator } from "./system-dashboard-refresh.js";
import { resolveSystemSnapshot } from "../system-snapshot.js";
import { parseSystemBackupResponse } from "../system-backup.js";
import {
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
    type ManagementEvidenceIdentity,
} from "../management-evidence-identity.js";

const {
    systemInfo: rawSystemInfo,
    systemInfoIdentity,
    systemInfoStatus,
    systemInfoError,
    fetchSystemInfo,
} = useApi({ adapters: false, readiness: false });
const toast = useToast();
const { confirm } = useConfirm();

const healthStatus = ref<ServiceProbeResult>({
    state: "warning",
    label: "检查中",
    detail: "正在读取服务存活证据",
});
const readyStatus = ref<ServiceProbeResult>(pendingReadinessProbe());
const healthLoading = ref(false);
const restartLoading = ref(false);
const backupLoading = ref(false);
const systemSnapshot = computed(() =>
    resolveSystemSnapshot(
        systemInfoStatus.value,
        systemInfoIdentity.value,
        systemInfoError.value,
        healthStatus.value,
    ),
);
const systemInfo = computed(() =>
    systemSnapshot.value.status === "ready" ? rawSystemInfo.value : null,
);

const AUTO_REFRESH_INTERVAL = 10_000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
const autoRefresh = ref(true);

const memoryUsagePercent = computed(() => {
    const info = systemInfo.value;
    if (!info || !info.total_memory) return "0.0";
    return (((info.total_memory - info.free_memory) / info.total_memory) * 100).toFixed(1);
});

const configStateLabel = computed(() => {
    const status = systemInfo.value?.configState.status;
    if (status === "in_sync") return "已应用";
    if (status === "drifted") return "磁盘配置待应用";
    return "无法校验";
});

const formatAppliedAt = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
};

const startAutoRefresh = () => {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
        void refreshDashboard();
    }, AUTO_REFRESH_INTERVAL);
};

const stopAutoRefresh = () => {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
};

watch(autoRefresh, val => {
    if (val) startAutoRefresh();
    else stopAutoRefresh();
});

async function handleBackup() {
    const info = systemInfo.value;
    if (!info?.instance_id || !info.application_version) {
        toast.error("无法确认当前系统快照实例，未发送备份请求");
        return;
    }
    const identity: ManagementEvidenceIdentity = {
        application: "onebots",
        version: info.application_version,
        instanceId: info.instance_id,
        ...(info.runtime_contract_id ? { runtimeContractId: info.runtime_contract_id } : {}),
    };
    backupLoading.value = true;
    try {
        const res = await authFetch(buildApiUrl("/api/system/backup-to-hf"), {
            method: "POST",
            headers: {
                "content-type": "application/json",
                [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: identity.instanceId,
            },
            body: JSON.stringify({ instance_id: identity.instanceId }),
            cache: "no-store",
            redirect: "error",
        });
        const result = await parseSystemBackupResponse(res, identity);
        if (result.success) {
            toast.success(result.message);
        } else {
            toast.error(result.message);
        }
    } catch (error) {
        toast.error((error as Error).message ?? "请求失败");
    } finally {
        backupLoading.value = false;
    }
}

async function loadServiceStatus() {
    healthLoading.value = true;
    try {
        const [health, readiness] = await Promise.all([probeHealth(), probeReadiness()]);
        healthStatus.value = health;
        readyStatus.value = reconcileServiceProbeInstances(health, readiness);
    } finally {
        healthLoading.value = false;
    }
}

const dashboardRefresh = createSystemDashboardRefreshCoordinator({
    refreshSystemInfo: fetchSystemInfo,
    refreshServiceStatus: loadServiceStatus,
});
const refreshDashboard = dashboardRefresh.refreshAll;
const refreshServiceStatus = dashboardRefresh.refreshServiceStatus;

async function handleRestart() {
    if (systemInfo.value?.restartSupported === false) {
        toast.warning("当前进程没有自动拉起监督器，请在宿主环境中手动重启");
        return;
    }
    const confirmed = await confirm({
        title: "重启服务",
        message:
            "重启后当前进程将退出。若在 Docker 中运行且已设置 restart 策略，容器将自动重新拉起；否则需手动重新启动服务。确认重启？",
        confirmText: "确认重启",
        cancelText: "取消",
        danger: true,
    });
    if (!confirmed) return;
    restartLoading.value = true;
    try {
        const previousIdentity = await readCurrentServiceIdentity();
        const acknowledgement = await requestServiceRestart(previousIdentity, authFetch);
        toast.info(`${acknowledgement.message}，正在验证新实例，请勿关闭页面`);
        await waitForServiceRestart(previousIdentity.instanceId);
        toast.success("新服务实例已上线，正在刷新页面");
        window.location.reload();
    } catch (error) {
        toast.error((error as Error).message || "请求失败");
    } finally {
        restartLoading.value = false;
    }
}

onMounted(() => {
    void refreshServiceStatus();
    if (autoRefresh.value) startAutoRefresh();
});

onUnmounted(() => {
    stopAutoRefresh();
});
</script>
