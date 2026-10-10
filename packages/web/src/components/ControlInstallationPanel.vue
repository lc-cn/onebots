<script setup lang="ts">
import {
    validInstallationSelection as validSelection,
    readInstallationTracking,
    persistInstallationTracking,
    persistInstallationActivation,
    clearInstallationTracking,
    installationTrackingError,
    type InstallationTracking as Tracking,
} from "./control-installation-tracking.js";
import { withInstallationTrackingLock } from "./control-installation-lock.js";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { IconRefresh } from "@tabler/icons-vue";
import type {
    ControlClient,
    ControlExtensionSelection,
    ControlInstallationCatalog,
    ControlInstallOperation,
    ControlInstallPlan,
    ControlUpdatePlan,
} from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";
import UiInfoTip from "../ui/UiInfoTip.vue";
import ControlExtensionChoices from "./ControlExtensionChoices.vue";
import ControlAdapterCatalogBrowser from "./ControlAdapterCatalogBrowser.vue";
import ControlInstallPlanPreview from "./ControlInstallPlanPreview.vue";
import ControlInstallationOperation from "./ControlInstallationOperation.vue";
import ControlUpdatePreview from "./ControlUpdatePreview.vue";
import type { ControlMutationBlock } from "../control-product-state.js";
import type { ExtensionCategory } from "../control-workspace.js";
import {
    createControlUpdateCheck,
    boundedControlRequest as bounded,
} from "./control-update-check.js";
const props = defineProps<{
    client: ControlClient;
    mutationBlock?: ControlMutationBlock;
    category: ExtensionCategory;
}>();
const emit = defineEmits<{ applied: []; categoryChange: [category: ExtensionCategory] }>();
type Catalog = ControlInstallationCatalog;
const catalog = ref<Catalog>();
const selected = ref<ControlExtensionSelection>({ adapters: [], protocols: [], applications: [] });
const plan = ref<ControlInstallPlan>();
const updatePreview = ref<ControlUpdatePlan>();
const tracking = ref<Tracking>();
const trackingUnavailable = ref(false);
const operation = ref<ControlInstallOperation>();
const privateToken = ref("");
const error = ref("");
const note = ref("");
const busy = ref(false);
const querying = ref(false);
const watching = ref(true);
const selectionKnown = ref(false);
const applied = ref(false);
let disposed = false;
let catalogRevision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const terminal = computed(
    () =>
        !!operation.value && ["verified", "failed", "interrupted"].includes(operation.value.phase),
);
const pending = computed(() => !!tracking.value && !terminal.value);
const privateNeeded = computed(
    () =>
        plan.value?.peers.some(peer => peer.packageName.startsWith("@icqqjs/")) ||
        plan.value?.selection.adapters.includes("icqq"),
);
const secureTransport =
    location.protocol === "https:" ||
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const categories = [
    { key: "platform", label: "平台" },
    { key: "protocol", label: "协议" },
    { key: "framework", label: "框架" },
] as const;
const secondarySection = computed(() =>
    props.category === "protocol"
        ? { key: "protocols" as const, label: "协议" }
        : { key: "applications" as const, label: "框架" },
);
const updateCheck = createControlUpdateCheck({
    client: () => props.client,
    blocked: () =>
        busy.value ||
        !!tracking.value ||
        disposed ||
        !!props.mutationBlock ||
        trackingUnavailable.value,
    bounded,
    begin: () => {
        catalogRevision++;
        busy.value = true;
        error.value = "";
        note.value = "";
        plan.value = undefined;
        updatePreview.value = undefined;
        privateToken.value = "";
    },
    accept: result => {
        updatePreview.value = result;
        plan.value = result.installationPlan;
    },
    fail: reason => {
        error.value =
            reason === "damaged"
                ? "当前配置已损坏，请先在系统运行设置中修复，再检查升级。"
                : "无法确认网关升级计划。请检查网络、安装收据和当前配置后重试；当前运行版本未改变。";
    },
    end: () => {
        busy.value = false;
    },
});
function leaveUpdate() {
    if (busy.value || tracking.value || disposed) return;
    updatePreview.value = undefined;
    plan.value = undefined;
    privateToken.value = "";
    void loadCatalog();
}
async function loadCatalog() {
    const request = ++catalogRevision;
    const client = props.client;
    try {
        const result: Catalog = await bounded(client.installationCatalog());
        if (disposed || request !== catalogRevision || client !== props.client) return;
        catalog.value = result;
        selectionKnown.value = validSelection(result.selection);
        if (selectionKnown.value && result.selection) {
            selected.value = {
                adapters: [...result.selection.adapters],
                protocols: [...result.selection.protocols],
                applications: [...result.selection.applications],
            };
        }
    } catch {
        if (disposed || request !== catalogRevision || client !== props.client) return;
        error.value = "无法读取安装目录，请稍后刷新。";
    }
}
function schedule() {
    clearTimeout(timer);
    if (!disposed && watching.value && pending.value) timer = setTimeout(() => void query(), 2000);
}
async function query() {
    if (!tracking.value || querying.value || disposed) return;
    const expected = tracking.value;
    querying.value = true;
    try {
        const result = await bounded(props.client.installation(expected.id));
        if (disposed || tracking.value?.id !== expected.id) return;
        if (result.id !== expected.id || result.planDigest !== expected.planDigest)
            throw new Error("identity");
        operation.value = result;
        error.value = "";
    } catch {
        error.value = "暂时无法确认安装结果。继续查询原操作，不会重复创建安装。";
    } finally {
        querying.value = false;
        schedule();
    }
}
async function createPlan() {
    if (
        busy.value ||
        disposed ||
        !selectionKnown.value ||
        tracking.value ||
        props.mutationBlock ||
        trackingUnavailable.value
    )
        return;
    updatePreview.value = undefined;
    busy.value = true;
    error.value = "";
    note.value = "";
    try {
        const result = await bounded(
            props.client.planInstallation(
                {
                    adapters: [...selected.value.adapters],
                    protocols: [...selected.value.protocols],
                    applications: [...selected.value.applications],
                },
                catalog.value!.activeGenerationId,
            ),
        );
        if (!disposed) plan.value = result;
    } catch {
        if (disposed) return;
        error.value =
            "无法生成安装计划。若要取消已安装扩展，请先在账号或协议页删除相关配置并保存，再刷新目录。";
        await loadCatalog();
    } finally {
        busy.value = false;
    }
}
async function install() {
    if (
        busy.value ||
        disposed ||
        trackingUnavailable.value ||
        (!tracking.value && !plan.value) ||
        props.mutationBlock
    )
        return;
    if (privateToken.value && !secureTransport) {
        error.value = "私有仓库授权需要 HTTPS 或本机连接。";
        return;
    }
    const client = props.client;
    const token = privateToken.value;
    let next: Tracking | undefined;
    busy.value = true;
    try {
        next = await withInstallationTrackingLock(() =>
            disposed || props.mutationBlock || trackingUnavailable.value
                ? undefined
                : persistInstallationTracking(localStorage, tracking.value, plan.value),
        );
    } catch (caught) {
        error.value = installationTrackingError(caught);
        busy.value = false;
        return;
    }
    if (!next) {
        busy.value = false;
        return;
    }
    // 记录写入后即使页面关闭也完成同编号提交，防止留下不存在的待查询操作。
    tracking.value = next;
    busy.value = true;
    error.value = "";
    note.value = "";
    watching.value = true;
    privateToken.value = "";
    try {
        operation.value = await bounded(
            client.install({ id: next.id, planId: next.planId, ...(token ? { token } : {}) }),
        );
    } catch {
        error.value = "提交结果暂不可确认，正在查询同一安装操作。";
        await query();
    } finally {
        busy.value = false;
        schedule();
    }
}
async function cancel() {
    if (!tracking.value || !pending.value || props.mutationBlock) return;
    busy.value = true;
    try {
        await bounded(props.client.cancelInstallation(tracking.value.id));
        note.value = "已请求取消，等待安装器结束并清理临时授权。";
    } catch {
        error.value = "取消结果暂不可确认，请继续查询原操作。";
    } finally {
        busy.value = false;
        watching.value = true;
        await query();
    }
}
async function apply() {
    if (
        busy.value ||
        trackingUnavailable.value ||
        operation.value?.phase !== "verified" ||
        !operation.value.candidateId ||
        !tracking.value ||
        tracking.value.activationRequested ||
        props.mutationBlock
    )
        return;
    busy.value = true;
    try {
        tracking.value = await withInstallationTrackingLock(() =>
            persistInstallationActivation(localStorage, tracking.value!),
        );
    } catch (caught) {
        error.value = installationTrackingError(caught);
        busy.value = false;
        return;
    }
    error.value = "";
    try {
        const result = await bounded(props.client.activateGeneration(operation.value.candidateId));
        if (result.status !== "succeeded") {
            error.value = result.rolledBack
                ? "应用失败，已恢复先前版本。"
                : "应用未完成，请检查网关及恢复状态。";
            return;
        }
        applied.value = true;
        note.value = "运行版本已应用。依赖已就绪，账号和协议仍需单独配置。";
        await loadCatalog();
        emit("applied");
    } catch {
        error.value = "应用结果暂不可确认，请核查网关状态，不要重复点击应用。";
        // 结果未知时先封住重复激活，保留安装操作供后续查询。
        applied.value = true;
        emit("applied");
    } finally {
        busy.value = false;
    }
}
async function newPlan() {
    if (
        !terminal.value ||
        !tracking.value ||
        busy.value ||
        props.mutationBlock ||
        trackingUnavailable.value
    )
        return;
    busy.value = true;
    try {
        await withInstallationTrackingLock(() =>
            clearInstallationTracking(localStorage, tracking.value!),
        );
    } catch (caught) {
        error.value = installationTrackingError(caught);
        return;
    } finally {
        busy.value = false;
    }
    tracking.value = undefined;
    operation.value = undefined;
    plan.value = undefined;
    updatePreview.value = undefined;
    privateToken.value = "";
    applied.value = false;
    error.value = "";
    note.value = "";
    await loadCatalog();
}
watch(
    selected,
    () => {
        if (!tracking.value) {
            plan.value = undefined;
            privateToken.value = "";
        }
    },
    { deep: true },
);
watch(watching, schedule);
onMounted(async () => {
    try {
        tracking.value = readInstallationTracking(localStorage);
        applied.value = tracking.value?.activationRequested === true;
    } catch (caught) {
        trackingUnavailable.value = true;
        error.value = installationTrackingError(caught);
    }
    await loadCatalog();
    if (tracking.value) await query();
});
onUnmounted(() => {
    disposed = true;
    updateCheck.dispose();
    clearTimeout(timer);
    privateToken.value = "";
});
</script>
<template>
    <section
        class="installation-panel border-t border-border pt-6 space-y-5"
        aria-labelledby="installation-heading">
        <header class="extension-description">
            <h1 id="installation-heading" class="text-lg font-medium">扩展</h1>
            <UiInfoTip
                label="扩展安装说明"
                text="选择需要的平台、协议或框架扩展后先确认计划。检查更新只读取版本信息，不会自动安装。" />
        </header>
        <div class="workspace-action-bar" role="toolbar" aria-label="扩展操作">
            <span class="workspace-action-context">{{
                tracking ? "安装操作进行中" : "选择并确认扩展"
            }}</span>
            <UiButton
                class="workspace-action-refresh"
                aria-label="刷新扩展目录"
                v-if="!tracking"
                :disabled="busy || !!updatePreview"
                @click="loadCatalog"
                ><IconRefresh :size="16" aria-hidden="true" /><span>刷新目录</span></UiButton
            >
            <UiButton
                v-if="!tracking"
                :disabled="busy || !!mutationBlock || trackingUnavailable"
                @click="updateCheck.run"
                >检查更新</UiButton
            >
            <UiButton
                v-if="!tracking && !updatePreview"
                variant="primary"
                :loading="busy"
                :disabled="!selectionKnown || !!mutationBlock || trackingUnavailable"
                @click="createPlan"
                >确认选择</UiButton
            >
        </div>
        <p v-if="busy && updateCheck.isRunning()" role="status" class="text-sm text-fg-secondary">
            正在读取并验证发布目录，最多等待两分钟。此步骤不会安装或应用运行版本。
        </p>
        <ControlUpdatePreview
            v-if="updatePreview && !tracking"
            :preview="updatePreview"
            :busy="busy"
            @leave="leaveUpdate" />
        <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
        <p v-if="note" role="status" class="text-sm text-fg-secondary">{{ note }}</p>
        <p v-if="mutationBlock" role="alert" class="text-sm text-danger">
            {{ mutationBlock.title }}，扩展目录保持只读；不会生成、安装或应用新版本。
        </p>
        <p
            v-if="catalog && !selectionKnown"
            class="border border-border rounded-control p-3 text-sm text-fg-secondary">
            服务端尚未提供当前完整依赖集合。为避免覆盖已安装扩展，暂不允许生成计划，请刷新或升级管理服务。
        </p>
        <div class="extension-category-tabs" role="group" aria-label="扩展分类">
            <button
                v-for="item in categories"
                :key="item.key"
                type="button"
                :aria-pressed="category === item.key"
                :class="{ active: category === item.key }"
                @click="emit('categoryChange', item.key)">
                {{ item.label }}
            </button>
        </div>
        <div v-if="catalog && !tracking && !updatePreview" class="space-y-5">
            <ControlAdapterCatalogBrowser
                v-if="category === 'platform'"
                v-model="selected.adapters"
                :entries="catalog.adapters"
                :installed="catalog.selection.adapters"
                :disabled="busy || !selectionKnown || !!mutationBlock || trackingUnavailable" />

            <ControlExtensionChoices
                v-else
                v-model="selected[secondarySection.key]"
                :label="secondarySection.label"
                :entries="catalog[secondarySection.key]"
                :installed="catalog.selection[secondarySection.key]"
                :disabled="busy || !selectionKnown || !!mutationBlock || trackingUnavailable" />
        </div>
        <ControlInstallPlanPreview
            v-if="plan && !tracking"
            v-model="privateToken"
            :plan="plan"
            :upgrade="!!updatePreview"
            :private-needed="!!privateNeeded"
            :secure-transport="secureTransport"
            :busy="busy"
            :blocked="!!mutationBlock || trackingUnavailable"
            @install="install" />
        <ControlInstallationOperation
            v-if="tracking"
            v-model="privateToken"
            :tracking="tracking"
            :operation="operation"
            :applied="applied"
            :secure-transport="secureTransport"
            :querying="querying"
            :pending="pending"
            :watching="watching"
            :busy="busy"
            :blocked="!!mutationBlock || trackingUnavailable"
            :terminal="terminal"
            @query="query"
            @toggle-watching="watching = !watching"
            @cancel="cancel"
            @install="install"
            @apply="apply"
            @new-plan="newPlan" />
    </section>
</template>
