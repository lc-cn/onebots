<template>
    <div class="h-full overflow-y-auto bg-bg">
        <div class="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
            <div class="mb-6 flex items-center justify-between gap-3 border-b border-border pb-4">
                <h2 class="flex items-center gap-2 text-xl font-semibold text-fg">
                    <IconRobot :size="22" stroke="1.5" class="text-fg-secondary" />
                    机器人管理
                </h2>
                <div class="flex items-center gap-2">
                    <UiBadge variant="neutral">共 {{ totalBotCount }} 个机器人</UiBadge>
                    <UiButton size="sm" @click="capabilitiesOpen = true">
                        <IconListCheck :size="14" />
                        <span class="hidden sm:inline">能力概览</span>
                    </UiButton>
                </div>
            </div>
            <UiAlert
                v-if="managementSnapshotStatus === 'unavailable'"
                variant="danger"
                title="账号运行态证据不可用"
                class="mb-4">
                {{ managementSnapshotError }}。页面不会展示或操作来源不一致的账号快照。
            </UiAlert>

            <UiEmpty
                v-if="totalBotCount === 0"
                title="暂无机器人"
                :description="onboarding.description">
                <div class="mt-2 flex flex-wrap justify-center gap-2">
                    <UiButton size="sm" @click="capabilitiesOpen = true">比较平台能力</UiButton>
                    <RouterLink v-slot="{ navigate }" custom :to="onboarding.route">
                        <UiButton
                            size="sm"
                            variant="primary"
                            :disabled="onboarding.actionDisabled"
                            @click="navigate">
                            {{ onboarding.actionLabel }}
                        </UiButton>
                    </RouterLink>
                </div>
            </UiEmpty>
            <div
                v-else
                class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
                <template v-for="adapter of trustedAdapters" :key="adapter.platform">
                    <BotCard
                        v-for="bot of adapter.accounts"
                        :key="`${bot.platform}:${bot.uin}`"
                        :bot="bot"
                        :adapter-icon="adapter.icon"
                        :lifecycle-control="adapter.accountLifecycleControl"
                        :loading="loadingBots.has(`${bot.platform}:${bot.uin}`)"
                        @start="handleBotStart"
                        @stop="handleBotStop" />
                </template>
            </div>
        </div>
        <AdapterCapabilitiesDrawer
            v-model="capabilitiesOpen"
            :adapters="capabilityAdapters"
            :catalog-status="managementSnapshotStatus"
            :catalog-error="managementSnapshotError"
            @retry="loadCapabilityCatalog" />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { IconListCheck, IconRobot } from "@tabler/icons-vue";
import UiBadge from "../ui/UiBadge.vue";
import UiButton from "../ui/UiButton.vue";
import UiEmpty from "../ui/UiEmpty.vue";
import UiAlert from "../ui/UiAlert.vue";
import { useToast } from "../ui/toast";
import { useApi } from "../composables/useApi";
import { authFetch } from "../composables/useAuth";
import { buildApiUrl } from "../config";
import { readManagementJsonResponse } from "../management-response.js";
import { reportClientError } from "../client-diagnostics";
import BotCard from "../components/BotCard.vue";
import AdapterCapabilitiesDrawer from "../components/AdapterCapabilitiesDrawer.vue";
import type { AccountInfo, AdapterCapabilityReport, ExtensionInfo } from "../types";
import {
    mergeCapabilityReportAdapters,
    parseAdapterCapabilityReport,
} from "../components/capability-presentation.js";
import { getBotOnboardingState } from "./bot-onboarding.js";
import type { ProtocolInventoryState } from "./bot-onboarding.js";
import { parseExtensionInventory } from "./extension-inventory.js";
import {
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "../management-evidence-identity.js";
import { resolveManagementSnapshot } from "../management-snapshot.js";

const {
    adapters,
    adapterInventoryIdentity,
    adapterInventoryStatus,
    adapterInventoryError,
    startBot,
    stopBot,
} = useApi({
    systemInfo: false,
    readiness: false,
});
const toast = useToast();

const loadingBots = ref<Set<string>>(new Set());
const capabilitiesOpen = ref(false);
const extensions = ref<ExtensionInfo[]>([]);
const extensionInventoryIdentity = ref<ManagementEvidenceIdentity | null>(null);
const extensionInventoryStatus = ref<"loading" | "ready" | "unavailable">("loading");
const capabilityReport = ref<AdapterCapabilityReport>({
    schemaVersion: 1,
    generatedAt: "",
    application: { name: "", version: "", instanceId: "" },
    complete: false,
    errors: [],
    adapters: [],
});
const capabilityCatalogStatus = ref<"loading" | "ready" | "unavailable">("loading");
const capabilityCatalogError = ref("");
const adapterInventoryIdentityKey = computed(() => identityKey(adapterInventoryIdentity.value));
const capabilityIdentity = computed<ManagementEvidenceIdentity | null>(() => {
    const application = capabilityReport.value.application;
    if (!application.name || !application.version || !application.instanceId) return null;
    return {
        application: application.name,
        version: application.version,
        instanceId: application.instanceId,
        ...(application.runtimeContractId
            ? { runtimeContractId: application.runtimeContractId }
            : {}),
    };
});
const managementSnapshot = computed(() =>
    resolveManagementSnapshot({
        adapterStatus: adapterInventoryStatus.value,
        adapterIdentity: adapterInventoryIdentity.value,
        adapterError: adapterInventoryError.value,
        capabilityStatus: capabilityCatalogStatus.value,
        capabilityIdentity: capabilityIdentity.value,
        capabilityError: capabilityCatalogError.value,
    }),
);
const managementSnapshotStatus = computed(() => managementSnapshot.value.status);
const managementSnapshotError = computed(() => managementSnapshot.value.error);
const trustedAdapters = computed(() =>
    managementSnapshotStatus.value === "ready" ? adapters.value : [],
);
const totalBotCount = computed(() =>
    trustedAdapters.value.reduce((count, adapter) => count + adapter.accounts.length, 0),
);
const capabilityAdapters = computed(() =>
    mergeCapabilityReportAdapters(trustedAdapters.value, capabilityReport.value),
);
const protocolInventory = computed<ProtocolInventoryState>(() => {
    if (
        extensionInventoryStatus.value === "loading" ||
        managementSnapshotStatus.value === "loading"
    )
        return "loading";
    if (
        extensionInventoryStatus.value === "unavailable" ||
        managementSnapshotStatus.value === "unavailable"
    )
        return "unavailable";
    const inventoryIdentity = extensionInventoryIdentity.value;
    if (
        !inventoryIdentity ||
        !capabilityIdentity.value ||
        !sameManagementEvidenceIdentity(inventoryIdentity, capabilityIdentity.value)
    ) {
        return "unavailable";
    }
    return extensions.value.some(extension => extension.type === "protocol" && extension.loaded)
        ? "available"
        : "missing";
});
const onboarding = computed(() =>
    getBotOnboardingState(trustedAdapters.value.length > 0, protocolInventory.value),
);

async function loadExtensionInventory() {
    try {
        const response = await authFetch(buildApiUrl("/api/extensions"));
        if (!response.ok) throw new Error("无法读取适配器能力目录");
        const identity = parseManagementEvidenceIdentity(response);
        const inventory = parseExtensionInventory(await readManagementJsonResponse(response));
        extensionInventoryIdentity.value = identity;
        extensions.value = inventory;
        extensionInventoryStatus.value = "ready";
    } catch (error) {
        extensionInventoryStatus.value = "unavailable";
        reportClientError("获取扩展清单失败", error);
    }
}

async function loadCapabilityCatalog() {
    if (capabilityCatalogStatus.value === "loading" && capabilityReport.value.adapters.length > 0) {
        return;
    }
    capabilityCatalogStatus.value = "loading";
    capabilityCatalogError.value = "";
    try {
        const response = await authFetch(buildApiUrl("/api/adapter-capabilities"));
        if (!response.ok) throw new Error(`能力清单请求失败（HTTP ${response.status}）`);
        capabilityReport.value = parseAdapterCapabilityReport(
            await readManagementJsonResponse(response),
        );
        capabilityCatalogError.value =
            capabilityReport.value.errors.join("；") ||
            (capabilityReport.value.complete ? "" : "存在未完成版本绑定的能力证据");
        capabilityCatalogStatus.value = "ready";
    } catch (error) {
        capabilityCatalogStatus.value = "unavailable";
        capabilityCatalogError.value = error instanceof Error ? error.message : "能力清单请求失败";
        reportClientError("获取独立适配器能力清单失败", error);
    }
}

onMounted(() => {
    void loadExtensionInventory();
    void loadCapabilityCatalog();
});

watch(adapterInventoryIdentityKey, (current, previous) => {
    if (current && current !== previous && capabilityCatalogStatus.value !== "loading") {
        void loadCapabilityCatalog();
    }
});

function identityKey(identity: ManagementEvidenceIdentity | null): string {
    return identity
        ? [identity.application, identity.version, identity.instanceId, identity.runtimeContractId]
              .filter(Boolean)
              .join("\n")
        : "";
}

const botKey = (bot: AccountInfo) => `${bot.platform}:${bot.uin}`;

const handleBotStart = async (bot: AccountInfo) => {
    const key = botKey(bot);
    loadingBots.value.add(key);
    try {
        const result = await startBot(bot.platform, bot.uin);
        if (result.success) {
            toast.success(`机器人 ${bot.uin} 已上线`);
        } else {
            toast.error(result.message);
        }
    } finally {
        loadingBots.value.delete(key);
    }
};

const handleBotStop = async (bot: AccountInfo) => {
    const key = botKey(bot);
    loadingBots.value.add(key);
    try {
        const result = await stopBot(bot.platform, bot.uin);
        if (result.success) {
            toast.warning(`机器人 ${bot.uin} 已下线`);
        } else {
            toast.error(result.message);
        }
    } finally {
        loadingBots.value.delete(key);
    }
};
</script>
