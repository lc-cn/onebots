<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type {
    ControlClient,
    ControlExtensionSelection,
    ControlInstallationCatalog,
    ControlInstallOperation,
    ControlInstallPlan,
    ControlUpdatePlan,
} from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";
import ControlAdapterCatalogBrowser from "./ControlAdapterCatalogBrowser.vue";
import ControlInstallPlanPreview from "./ControlInstallPlanPreview.vue";
import ControlUpdatePreview from "./ControlUpdatePreview.vue";
import type { ControlMutationBlock } from "../control-product-state.js";
import {
    createControlUpdateCheck,
    boundedControlRequest as bounded,
} from "./control-update-check.js";
const props = defineProps<{ client: ControlClient; mutationBlock?: ControlMutationBlock }>();
const emit = defineEmits<{ applied: [] }>();
type Catalog = ControlInstallationCatalog;
type Tracking = Pick<ControlInstallOperation, "id" | "planDigest"> & {
    planId: string;
    activationRequested?: boolean;
};
const STORAGE_KEY = "onebots.control.installation";
const catalog = ref<Catalog>();
const selected = ref<ControlExtensionSelection>({ adapters: [], protocols: [], applications: [] });
const plan = ref<ControlInstallPlan>();
const updatePreview = ref<ControlUpdatePlan>();
const tracking = ref<Tracking>();
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
const sections = [
    { key: "adapters", label: "平台适配器" },
    { key: "protocols", label: "输出协议" },
    { key: "applications", label: "框架扩展" },
] as const;
const phaseLabels = {
    queued: "等待安装",
    downloading: "下载依赖",
    verifying: "验证宿主、依赖与扩展",
    verified: "验证通过，尚未应用",
    failed: "安装失败",
    interrupted: "操作中断，需要核查",
};
function validSelection(value: unknown): value is ControlExtensionSelection {
    if (!value || typeof value !== "object") return false;
    return ["adapters", "protocols", "applications"].every(key => {
        const items = (value as Record<string, unknown>)[key];
        return Array.isArray(items) && items.every(item => typeof item === "string");
    });
}
const updateCheck = createControlUpdateCheck({
    client: () => props.client,
    blocked: () => busy.value || !!tracking.value || disposed || !!props.mutationBlock,
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
                ? "当前配置已损坏，请先在配置管理中修复，再检查升级。"
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
    if (busy.value || disposed || !selectionKnown.value || tracking.value || props.mutationBlock)
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
            "无法生成安装计划。若要取消已安装扩展，请先在配置管理中删除对应账号或协议引用、取消启用并应用配置，再刷新目录。";
        await loadCatalog();
    } finally {
        busy.value = false;
    }
}
async function install() {
    if (busy.value || (!tracking.value && !plan.value) || props.mutationBlock) return;
    if (privateToken.value && !secureTransport) {
        error.value = "私有仓库授权需要 HTTPS 或本机连接。";
        return;
    }
    const next = tracking.value ?? {
        id: crypto.randomUUID(),
        planId: plan.value!.id,
        planDigest: plan.value!.planDigest,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        error.value = "无法保存操作标识，请允许浏览器本地存储后再安装。";
        return;
    }
    tracking.value = next;
    busy.value = true;
    error.value = "";
    note.value = "";
    watching.value = true;
    const token = privateToken.value;
    privateToken.value = "";
    try {
        operation.value = await bounded(
            props.client.install({ id: next.id, planId: next.planId, ...(token ? { token } : {}) }),
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
        operation.value?.phase !== "verified" ||
        !operation.value.candidateId ||
        !tracking.value ||
        tracking.value.activationRequested ||
        props.mutationBlock
    )
        return;
    const requested = { ...tracking.value, activationRequested: true };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(requested));
    } catch {
        error.value = "无法保存应用记录，请允许浏览器本地存储。";
        return;
    }
    tracking.value = requested;
    busy.value = true;
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
    if (!terminal.value) return;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        error.value = "无法清除浏览器中的旧操作记录。";
        return;
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
        const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
        if (
            value &&
            typeof value.id === "string" &&
            /^[a-zA-Z0-9_-]{1,128}$/.test(value.id) &&
            typeof value.planId === "string" &&
            /^[a-f0-9]{64}$/.test(value.planId) &&
            typeof value.planDigest === "string" &&
            /^[a-f0-9]{64}$/.test(value.planDigest)
        ) {
            tracking.value = {
                id: value.id,
                planId: value.planId,
                planDigest: value.planDigest,
                activationRequested: value.activationRequested === true,
            };
            applied.value = tracking.value.activationRequested === true;
        }
    } catch {
        error.value = "无法读取浏览器中的安装记录。";
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
    <section class="border-t border-border pt-6 space-y-5" aria-labelledby="installation-heading">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 id="installation-heading" class="text-lg font-medium">安装、扩展与升级</h2>
                <p class="text-sm text-fg-secondary mt-2">
                    选择完整依赖集合。取消勾选会创建不含该扩展的新候选；被账号或协议配置引用时会拒绝。安装先验证，确认后再应用。
                </p>
            </div>
            <UiButton v-if="!tracking" :disabled="busy || !!updatePreview" @click="loadCatalog"
                >刷新目录</UiButton
            >
        </div>
        <div v-if="!tracking" class="flex flex-wrap items-center gap-3">
            <UiButton :disabled="busy || !!mutationBlock" @click="updateCheck.run"
                >检查网关升级</UiButton
            >
            <p class="text-sm text-fg-secondary">只升级网关运行版本，不升级管理服务或 CLI。</p>
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
        <div v-if="catalog && !tracking && !updatePreview" class="space-y-5">
            <ControlAdapterCatalogBrowser
                v-model="selected.adapters"
                :entries="catalog.adapters"
                :disabled="busy || !selectionKnown || !!mutationBlock" />

            <div class="grid gap-4 sm:grid-cols-2">
                <fieldset
                    v-for="section in sections.slice(1)"
                    :key="section.key"
                    :disabled="busy || !selectionKnown || !!mutationBlock"
                    class="border border-border rounded-panel p-4 bg-surface">
                    <legend class="px-1 text-sm font-medium">{{ section.label }}</legend>
                    <div class="space-y-3 max-h-64 overflow-y-auto pt-1">
                        <label
                            v-for="entry in catalog[section.key]"
                            :key="entry.name"
                            class="flex min-h-11 items-center gap-2 text-sm cursor-pointer">
                            <input
                                v-model="selected[section.key]"
                                type="checkbox"
                                :value="entry.name"
                                class="mt-1 accent-accent" />
                            <span
                                >{{ entry.displayName
                                }}<span class="block text-xs text-fg-muted">{{
                                    entry.name
                                }}</span></span
                            >
                        </label>
                        <p v-if="!catalog[section.key].length" class="text-sm text-fg-muted">
                            暂无可选项
                        </p>
                    </div>
                    <p
                        v-if="
                            selected[section.key].some(
                                name => !catalog![section.key].some(entry => entry.name === name),
                            )
                        "
                        class="text-xs text-danger mt-3">
                        当前集合含目录外扩展，已保留选择；请先由管理员核查。
                    </p>
                </fieldset>
            </div>
        </div>
        <UiButton
            v-if="!tracking && !updatePreview"
            variant="primary"
            :loading="busy"
            :disabled="!selectionKnown || !!mutationBlock"
            @click="createPlan"
            >查看安装计划</UiButton
        >
        <ControlInstallPlanPreview
            v-if="plan && !tracking"
            v-model="privateToken"
            :plan="plan"
            :upgrade="!!updatePreview"
            :private-needed="!!privateNeeded"
            :secure-transport="secureTransport"
            :busy="busy"
            :blocked="!!mutationBlock"
            @install="install" />
        <section
            v-if="tracking"
            class="border border-border rounded-panel p-4 space-y-4"
            aria-live="polite">
            <p class="font-medium">
                {{
                    applied
                        ? "请查看当前网关状态"
                        : operation
                          ? phaseLabels[operation.phase]
                          : "正在核实安装操作"
                }}
            </p>
            <p class="text-xs text-fg-muted break-all">操作标识：{{ tracking.id }}</p>
            <p v-if="operation?.phase === 'failed'" class="text-sm text-danger">
                依赖未通过安装或验证，当前运行版本未改变。请检查网络、授权与依赖兼容性。
            </p>
            <p v-if="operation?.phase === 'interrupted'" class="text-sm text-danger">
                安装过程被中断。保留了操作记录，请先核查，不会自动重新安装或应用。
            </p>
            <p v-if="tracking.activationRequested" class="text-sm text-fg-secondary">
                已提交过应用请求，请核查上方网关状态。刷新页面不会再次提交应用。
            </p>
            <label v-if="!operation && secureTransport" class="block space-y-2 text-sm"
                ><span>重新提供下载授权（仅私有依赖需要）</span
                ><input
                    v-model="privateToken"
                    type="password"
                    autocomplete="off"
                    maxlength="512"
                    class="w-full rounded-control border border-border bg-surface p-3"
            /></label>
            <div class="flex flex-wrap gap-3">
                <UiButton :loading="querying" @click="query">查询状态</UiButton>
                <UiButton v-if="pending" @click="watching = !watching">{{
                    watching ? "暂停自动刷新" : "恢复自动刷新"
                }}</UiButton>
                <UiButton v-if="pending" :loading="busy" :disabled="!!mutationBlock" @click="cancel"
                    >取消安装</UiButton
                >
                <UiButton
                    v-if="!operation"
                    :loading="busy"
                    :disabled="!!mutationBlock"
                    @click="install"
                    >重新提交同一操作</UiButton
                >
                <UiButton
                    v-if="operation?.phase === 'verified' && !tracking.activationRequested"
                    variant="primary"
                    :loading="busy"
                    :disabled="!!mutationBlock"
                    @click="apply"
                    >应用此运行版本</UiButton
                >
                <UiButton v-if="terminal" :disabled="busy" @click="newPlan"
                    >准备下一次安装</UiButton
                >
            </div>
            <p v-if="pending && !watching" class="text-xs text-fg-muted">
                已暂停刷新，后台安装仍继续；恢复刷新会查询同一操作。
            </p>
        </section>
    </section>
</template>
