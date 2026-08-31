<template>
    <div class="h-full overflow-y-auto">
        <div class="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
            <div>
                <h1 class="text-2xl font-semibold text-fg">功能扩展</h1>
                <p class="mt-1 text-sm text-fg-secondary">
                    安装平台适配器和开放协议。依赖、启动配置和服务重启都由 OneBots 完成。
                </p>
            </div>

            <UiAlert v-if="restarting" variant="warning">
                服务正在重启，页面会在恢复后自动刷新，请勿关闭。
            </UiAlert>
            <UiAlert v-if="errorMessage" variant="danger">{{ errorMessage }}</UiAlert>
            <UiAlert v-if="catalogErrorMessage" variant="danger">
                {{ catalogErrorMessage }}。扩展安装已禁用；现有运行时插件仍可继续配置和使用。
            </UiAlert>
            <UiAlert v-if="activeInstallation" variant="warning">
                <p>
                    {{ activeInstallation.displayName }}：{{
                        installationProgress(activeInstallation)?.label ?? "正在安装扩展"
                    }}。完成前暂不能开始其他扩展安装。
                </p>
                <p
                    v-if="installationProgress(activeInstallation)?.detail"
                    class="mt-1 font-mono text-xs opacity-75">
                    {{ installationProgress(activeInstallation)?.detail }}
                </p>
            </UiAlert>

            <div class="flex flex-wrap gap-2">
                <UiButton
                    v-for="option in filters"
                    :key="option.value"
                    size="sm"
                    :variant="filter === option.value ? 'primary' : 'ghost'"
                    @click="filter = option.value">
                    {{ option.label }}
                </UiButton>
                <div class="relative min-w-56 flex-1 sm:max-w-sm">
                    <IconSearch
                        :size="15"
                        class="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-fg-tertiary" />
                    <UiInput
                        v-model="searchKeyword"
                        clearable
                        placeholder="搜索平台或能力，如 group file"
                        class="[&_input]:pl-9" />
                </div>
                <span class="self-center text-xs tabular-nums text-fg-tertiary">
                    {{ visibleExtensions.length }}/{{ filteredExtensions.length }} 项
                </span>
            </div>

            <div v-if="loading" class="flex justify-center py-20"><UiSpinner /></div>
            <UiEmpty
                v-else-if="visibleExtensions.length === 0"
                title="没有匹配的平台或能力"
                description="能力搜索只返回原生支持或可模拟实现的清单条目。" />
            <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <UiCard v-for="extension in visibleExtensions" :key="extension.id">
                    <template #header>
                        <div class="flex min-w-0 flex-1 items-center gap-2">
                            <span class="font-semibold text-fg">{{ extension.displayName }}</span>
                            <UiBadge
                                :variant="extension.type === 'adapter' ? 'success' : 'neutral'">
                                {{ extension.type === "adapter" ? "平台" : "协议" }}
                            </UiBadge>
                            <UiBadge
                                v-if="runtimeStatus(extension)"
                                :variant="runtimeStatus(extension)?.variant"
                                dot>
                                {{ runtimeStatus(extension)?.label }}
                            </UiBadge>
                        </div>
                    </template>

                    <div class="space-y-4">
                        <div>
                            <p class="text-sm text-fg-secondary">{{ extension.description }}</p>
                            <p class="mt-1 font-mono text-xs text-fg-tertiary">
                                {{ extension.packageName }}
                            </p>
                            <div
                                class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-tertiary">
                                <span v-if="extension.targetVersion">
                                    验证版本 v{{ extension.targetVersion }}
                                </span>
                                <span v-else>验证版本不可用</span>
                                <span v-if="extension.installedVersion">
                                    已安装 v{{ extension.installedVersion }}
                                </span>
                            </div>
                        </div>

                        <UiAlert v-if="extension.installedError" variant="danger">
                            已安装依赖无法验证：{{ extension.installedError }}。重新安装会使用当前
                            OneBots 固定的包名和版本修复该目录。
                        </UiAlert>

                        <UiAlert
                            v-if="
                                extension.targetVersion &&
                                extension.installedVersion &&
                                !extension.versionAligned
                            "
                            variant="warning">
                            已安装版本与当前 OneBots 验证版本不一致。能力目录和兼容性预检对应 v{{
                                extension.targetVersion
                            }}；可切换后重启。
                        </UiAlert>

                        <UiAlert
                            v-if="extension.loaded && extension.configurationError"
                            variant="warning">
                            配置入口不可用：{{ extension.configurationError }}
                        </UiAlert>

                        <UiAlert
                            v-if="installationProgress(extension)"
                            :variant="installationProgress(extension)?.variant">
                            <p>{{ installationProgress(extension)?.label }}</p>
                            <p
                                v-if="installationProgress(extension)?.detail"
                                class="mt-1 font-mono text-xs opacity-75">
                                {{ installationProgress(extension)?.detail }}
                            </p>
                        </UiAlert>

                        <ExtensionCapabilities
                            v-if="extension.capability"
                            :capability="extension.capability"
                            :query="searchKeyword" />

                        <details v-if="extension.loaded" class="group">
                            <summary
                                class="cursor-pointer text-sm font-medium text-accent select-none hover:underline">
                                配置引导（{{ extension.setup.length }} 步）
                            </summary>
                            <ol class="mt-3 space-y-3">
                                <li
                                    v-for="(step, index) in extension.setup"
                                    :key="step.title"
                                    class="flex gap-3 rounded-lg border border-border-subtle p-3">
                                    <span
                                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                                        {{ index + 1 }}
                                    </span>
                                    <div class="min-w-0">
                                        <p class="text-sm font-medium text-fg">{{ step.title }}</p>
                                        <p class="mt-0.5 text-xs leading-5 text-fg-secondary">
                                            {{ step.description }}
                                        </p>
                                        <a
                                            v-if="step.url"
                                            :href="step.url"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            class="mt-1 inline-flex text-xs font-medium text-accent hover:underline">
                                            打开官方页面
                                        </a>
                                    </div>
                                </li>
                            </ol>
                        </details>

                        <div class="flex justify-end gap-2">
                            <RouterLink
                                v-if="extension.loaded && configurationAction(extension).available"
                                v-slot="{ navigate }"
                                custom
                                :to="configurationAction(extension).to">
                                <UiButton
                                    :variant="extension.versionAligned ? 'primary' : 'ghost'"
                                    @click="navigate">
                                    {{ configurationAction(extension).label }}
                                </UiButton>
                            </RouterLink>
                            <UiButton
                                v-if="installationAction(extension).visible"
                                variant="primary"
                                :loading="installingId === extension.id || extension.installing"
                                :disabled="
                                    restarting ||
                                    Boolean(installingId) ||
                                    Boolean(activeInstallation) ||
                                    !installationAction(extension).available
                                "
                                @click="install(extension)">
                                {{ installationAction(extension).label }}
                            </UiButton>
                        </div>
                    </div>
                </UiCard>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { IconSearch } from "@tabler/icons-vue";
import type { ExtensionInfo } from "../types";
import { buildApiUrl } from "../config";
import { authFetch } from "../composables/useAuth";
import {
    readCurrentServiceInstanceId,
    requestServiceRestart,
    waitForServiceRestart,
} from "../utils/service-restart";
import ExtensionCapabilities from "../components/ExtensionCapabilities.vue";
import { UiAlert, UiBadge, UiButton, UiCard, UiEmpty, UiInput, UiSpinner } from "../ui";
import { matchesExtensionSearch } from "../components/capability-search.js";
import { parseExtensionFilter, type ExtensionFilter } from "./extension-filter.js";
import { getExtensionConfigurationAction } from "./extension-configuration.js";
import {
    getExtensionInstallRequestRecovery,
    getExtensionInstallationAction,
    getExtensionInstallationProgress,
    getExtensionRuntimeStatus,
} from "./extension-installation.js";

const route = useRoute();
const extensions = ref<ExtensionInfo[]>([]);
const loading = ref(true);
const filter = ref<ExtensionFilter>("all");
const searchKeyword = ref("");
const installingId = ref("");
const restarting = ref(false);
const errorMessage = ref("");
let installationRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let installationRefreshAttempts = 0;
let isMounted = false;
let disconnectedInstallation: {
    id: string;
    previousOperationId: string | null;
    requestMessage: string;
} | null = null;
let recoveringDisconnectedInstallation = false;
const INSTALLATION_REFRESH_INTERVAL_MS = 1_500;
// 覆盖服务端 10 分钟包安装与最多 3 次、每次 60 秒的隔离预检，并留出观察余量。
const INSTALLATION_STATUS_TIMEOUT_MS = 14 * 60 * 1_000;
const MAX_INSTALLATION_REFRESH_ATTEMPTS = Math.ceil(
    INSTALLATION_STATUS_TIMEOUT_MS / INSTALLATION_REFRESH_INTERVAL_MS,
);
const filters: Array<{ value: ExtensionFilter; label: string }> = [
    { value: "all", label: "全部" },
    { value: "adapter", label: "平台适配器" },
    { value: "protocol", label: "开放协议" },
];

watch(
    () => route.query.type,
    value => {
        filter.value = parseExtensionFilter(value);
    },
    { immediate: true },
);

const configurationAction = (extension: ExtensionInfo) =>
    getExtensionConfigurationAction(extension);
const installationAction = (extension: ExtensionInfo) => getExtensionInstallationAction(extension);
const installationProgress = (extension: ExtensionInfo) =>
    getExtensionInstallationProgress(extension);
const runtimeStatus = (extension: ExtensionInfo) => getExtensionRuntimeStatus(extension);

const catalogErrorMessage = computed(
    () => extensions.value.find(extension => extension.catalogError)?.catalogError ?? "",
);
const activeInstallation = computed(
    () => extensions.value.find(extension => extension.installing) ?? null,
);

const filteredExtensions = computed(() =>
    filter.value === "all"
        ? extensions.value
        : extensions.value.filter(item => item.type === filter.value),
);
const visibleExtensions = computed(() =>
    filteredExtensions.value.filter(extension =>
        matchesExtensionSearch(extension, searchKeyword.value),
    ),
);

function clearInstallationRefresh(): void {
    if (installationRefreshTimer !== null) clearTimeout(installationRefreshTimer);
    installationRefreshTimer = null;
}

function scheduleInstallationRefresh(): void {
    clearInstallationRefresh();
    if (!isMounted) return;
    if (!extensions.value.some(extension => extension.installing)) {
        installationRefreshAttempts = 0;
        return;
    }
    if (installationRefreshAttempts >= MAX_INSTALLATION_REFRESH_ATTEMPTS) {
        errorMessage.value = "扩展安装状态确认超时，请刷新页面检查最终结果";
        return;
    }
    installationRefreshAttempts += 1;
    installationRefreshTimer = setTimeout(() => {
        installationRefreshTimer = null;
        void loadExtensions(true);
    }, INSTALLATION_REFRESH_INTERVAL_MS);
}

async function loadExtensions(background = false): Promise<void> {
    if (!background) {
        loading.value = true;
        installationRefreshAttempts = 0;
    }
    errorMessage.value = "";
    try {
        const response = await authFetch(buildApiUrl("/api/extensions"));
        if (!response.ok) throw new Error("无法读取扩展目录");
        extensions.value = await response.json();
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
        if (!background) loading.value = false;
        scheduleInstallationRefresh();
        void resumeDisconnectedInstallation();
    }
}

async function restartAfterInstallation(): Promise<void> {
    restarting.value = true;
    const previousInstanceId = await readCurrentServiceInstanceId();
    await requestServiceRestart(previousInstanceId, authFetch);
    await waitForServiceRestart(previousInstanceId);
    window.location.reload();
}

async function resumeDisconnectedInstallation(): Promise<void> {
    if (!disconnectedInstallation || recoveringDisconnectedInstallation || !isMounted) return;
    const pending = disconnectedInstallation;
    const refreshed = extensions.value.find(item => item.id === pending.id);
    const recovery = getExtensionInstallRequestRecovery(pending.previousOperationId, refreshed);
    if (recovery.status === "running") return;

    disconnectedInstallation = null;
    if (recovery.status === "failed") {
        errorMessage.value = recovery.message;
        return;
    }
    if (recovery.status === "unknown") {
        errorMessage.value = pending.requestMessage;
        return;
    }

    recoveringDisconnectedInstallation = true;
    try {
        await restartAfterInstallation();
    } catch (error) {
        restarting.value = false;
        await loadExtensions();
        errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
        recoveringDisconnectedInstallation = false;
    }
}

async function install(extension: ExtensionInfo): Promise<void> {
    const previousOperationId = extension.lastInstallation?.operationId ?? null;
    installingId.value = extension.id;
    errorMessage.value = "";
    try {
        let shouldRestart = false;
        try {
            const response = await authFetch(
                buildApiUrl(`/api/extensions/${encodeURIComponent(extension.id)}/install`),
                { method: "POST" },
            );
            const result = (await response.json()) as { success: boolean; message?: string };
            if (!response.ok || !result.success) {
                throw new Error(result.message || "扩展安装失败");
            }
            shouldRestart = true;
        } catch (error) {
            const requestMessage = error instanceof Error ? error.message : String(error);
            await loadExtensions();
            const refreshed = extensions.value.find(item => item.id === extension.id);
            const recovery = getExtensionInstallRequestRecovery(previousOperationId, refreshed);
            if (recovery.status === "running") {
                disconnectedInstallation = {
                    id: extension.id,
                    previousOperationId,
                    requestMessage,
                };
                return;
            }
            if (recovery.status === "succeeded") {
                shouldRestart = true;
            } else {
                errorMessage.value =
                    recovery.status === "failed" ? recovery.message : requestMessage;
                return;
            }
        }

        if (shouldRestart) await restartAfterInstallation();
    } catch (error) {
        restarting.value = false;
        await loadExtensions();
        errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
        installingId.value = "";
    }
}

onMounted(() => {
    isMounted = true;
    void loadExtensions();
});
onUnmounted(() => {
    isMounted = false;
    clearInstallationRefresh();
});
</script>
