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

            <div class="flex flex-wrap gap-2">
                <UiButton
                    v-for="option in filters"
                    :key="option.value"
                    size="sm"
                    :variant="filter === option.value ? 'primary' : 'ghost'"
                    @click="filter = option.value">
                    {{ option.label }}
                </UiButton>
            </div>

            <div v-if="loading" class="flex justify-center py-20"><UiSpinner /></div>
            <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <UiCard v-for="extension in visibleExtensions" :key="extension.id">
                    <template #header>
                        <div class="flex min-w-0 flex-1 items-center gap-2">
                            <span class="font-semibold text-fg">{{ extension.displayName }}</span>
                            <UiBadge
                                :variant="extension.type === 'adapter' ? 'success' : 'neutral'">
                                {{ extension.type === "adapter" ? "平台" : "协议" }}
                            </UiBadge>
                            <UiBadge v-if="extension.loaded" variant="success" dot>已启用</UiBadge>
                            <UiBadge v-else-if="extension.installed" variant="warning" dot>
                                等待重启
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
                                <span>验证版本 v{{ extension.targetVersion }}</span>
                                <span v-if="extension.installedVersion">
                                    已安装 v{{ extension.installedVersion }}
                                </span>
                            </div>
                        </div>

                        <UiAlert
                            v-if="extension.installedVersion && !extension.versionAligned"
                            variant="warning">
                            已安装版本与当前 OneBots 验证版本不一致。能力目录和兼容性预检对应 v{{
                                extension.targetVersion
                            }}；可切换后重启。
                        </UiAlert>

                        <ExtensionCapabilities
                            v-if="extension.capability"
                            :capability="extension.capability" />

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
                                v-if="extension.loaded"
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
                                v-if="!extension.loaded || !extension.versionAligned"
                                variant="primary"
                                :loading="installingId === extension.id || extension.installing"
                                :disabled="restarting || Boolean(installingId)"
                                @click="install(extension)">
                                {{ installActionLabel(extension) }}
                            </UiButton>
                        </div>
                    </div>
                </UiCard>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { ExtensionInfo } from "../types";
import { buildApiUrl } from "../config";
import { authFetch } from "../composables/useAuth";
import { readCurrentServiceInstanceId, waitForServiceRestart } from "../utils/service-restart";
import ExtensionCapabilities from "../components/ExtensionCapabilities.vue";
import { UiAlert, UiBadge, UiButton, UiCard, UiSpinner } from "../ui";
import { parseExtensionFilter, type ExtensionFilter } from "./extension-filter.js";
import { getExtensionConfigurationAction } from "./extension-configuration.js";

const route = useRoute();
const extensions = ref<ExtensionInfo[]>([]);
const loading = ref(true);
const filter = ref<ExtensionFilter>("all");
const installingId = ref("");
const restarting = ref(false);
const errorMessage = ref("");
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

function installActionLabel(extension: ExtensionInfo): string {
    if (!extension.installed) return `安装 v${extension.targetVersion} 并重启`;
    if (!extension.versionAligned) return `切换至 v${extension.targetVersion} 并重启`;
    return "启用并重启";
}

const configurationAction = (extension: ExtensionInfo) =>
    getExtensionConfigurationAction(extension);

const visibleExtensions = computed(() =>
    filter.value === "all"
        ? extensions.value
        : extensions.value.filter(item => item.type === filter.value),
);

async function loadExtensions(): Promise<void> {
    loading.value = true;
    errorMessage.value = "";
    try {
        const response = await authFetch(buildApiUrl("/api/extensions"));
        if (!response.ok) throw new Error("无法读取扩展目录");
        extensions.value = await response.json();
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
        loading.value = false;
    }
}

async function install(extension: ExtensionInfo): Promise<void> {
    installingId.value = extension.id;
    errorMessage.value = "";
    try {
        const response = await authFetch(
            buildApiUrl(`/api/extensions/${encodeURIComponent(extension.id)}/install`),
            { method: "POST" },
        );
        const result = (await response.json()) as { success: boolean; message?: string };
        if (!response.ok || !result.success) throw new Error(result.message || "扩展安装失败");

        restarting.value = true;
        const previousInstanceId = await readCurrentServiceInstanceId();
        const restart = await authFetch(buildApiUrl("/api/system/restart"), { method: "POST" });
        const restartResult = (await restart.json()) as { success: boolean; message?: string };
        if (!restart.ok || !restartResult.success) {
            throw new Error(
                restartResult.message || "扩展已安装，但服务重启失败，请在系统信息页手动重启",
            );
        }
        await waitForServiceRestart(previousInstanceId);
        window.location.reload();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        restarting.value = false;
        await loadExtensions();
        errorMessage.value = message;
    } finally {
        installingId.value = "";
    }
}

onMounted(loadExtensions);
</script>
