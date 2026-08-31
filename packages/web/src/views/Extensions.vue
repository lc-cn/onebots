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
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { ExtensionInfo } from "../types";
import { buildApiUrl } from "../config";
import { authFetch } from "../composables/useAuth";
import {
    readCurrentServiceInstanceId,
    requestServiceRestart,
    waitForServiceRestart,
} from "../utils/service-restart";
import ExtensionCapabilities from "../components/ExtensionCapabilities.vue";
import { UiAlert, UiBadge, UiButton, UiCard, UiSpinner } from "../ui";
import { parseExtensionFilter, type ExtensionFilter } from "./extension-filter.js";
import { getExtensionConfigurationAction } from "./extension-configuration.js";
import {
    getExtensionInstallationAction,
    getExtensionRuntimeStatus,
} from "./extension-installation.js";

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

const configurationAction = (extension: ExtensionInfo) =>
    getExtensionConfigurationAction(extension);
const installationAction = (extension: ExtensionInfo) => getExtensionInstallationAction(extension);
const runtimeStatus = (extension: ExtensionInfo) => getExtensionRuntimeStatus(extension);

const catalogErrorMessage = computed(
    () => extensions.value.find(extension => extension.catalogError)?.catalogError ?? "",
);

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
        await requestServiceRestart(previousInstanceId, authFetch);
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
