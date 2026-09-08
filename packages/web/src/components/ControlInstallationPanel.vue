<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type {
    ControlClient,
    ControlExtensionSelection,
    ControlInstallationCatalog,
    ControlInstallOperation,
    ControlInstallPlan,
} from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{ client: ControlClient }>();
const emit = defineEmits<{ applied: [] }>();
type Catalog = ControlInstallationCatalog;
interface Tracking {
    id: string;
    planId: string;
    planDigest: string;
    activationRequested?: boolean;
}
const STORAGE_KEY = "onebots.control.installation";
const catalog = ref<Catalog>();
const selected = ref<ControlExtensionSelection>({ adapters: [], protocols: [], applications: [] });
const plan = ref<ControlInstallPlan>();
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

async function bounded<T>(promise: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error("timeout")), 15_000);
            }),
        ]);
    } finally {
        clearTimeout(timeout);
    }
}

async function loadCatalog() {
    try {
        const result: Catalog = await bounded(props.client.installationCatalog());
        if (disposed) return;
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
    if (!selectionKnown.value || tracking.value) return;
    busy.value = true;
    error.value = "";
    note.value = "";
    try {
        plan.value = await bounded(
            props.client.planInstallation(
                {
                    adapters: [...selected.value.adapters],
                    protocols: [...selected.value.protocols],
                    applications: [...selected.value.applications],
                },
                catalog.value!.activeGenerationId,
            ),
        );
    } catch {
        error.value = "无法生成安装计划，请刷新目录后重新确认所选扩展。";
        await loadCatalog();
    } finally {
        busy.value = false;
    }
}

async function install() {
    if (busy.value || (!tracking.value && !plan.value)) return;
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
    if (!tracking.value || !pending.value) return;
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
        tracking.value.activationRequested
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
    clearTimeout(timer);
    privateToken.value = "";
});
</script>

<template>
    <section class="border-t border-border pt-6 space-y-5" aria-labelledby="installation-heading">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 id="installation-heading" class="text-lg font-medium">安装与扩展</h2>
                <p class="text-sm text-fg-secondary mt-2">
                    选择完整依赖集合。安装先验证，确认后再应用；不会自动创建账号或开启协议。
                </p>
            </div>
            <UiButton v-if="!tracking" :disabled="busy" @click="loadCatalog">刷新目录</UiButton>
        </div>
        <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
        <p v-if="note" role="status" class="text-sm text-fg-secondary">{{ note }}</p>
        <p
            v-if="catalog && !selectionKnown"
            class="border border-border rounded-control p-3 text-sm text-fg-secondary">
            服务端尚未提供当前完整依赖集合。为避免覆盖已安装扩展，暂不允许生成计划，请刷新或升级管理服务。
        </p>
        <div v-if="catalog && !tracking" class="grid gap-4 sm:grid-cols-3">
            <fieldset
                v-for="section in sections"
                :key="section.key"
                :disabled="busy || !selectionKnown"
                class="border border-border rounded-panel p-4 bg-surface">
                <legend class="px-1 text-sm font-medium">{{ section.label }}</legend>
                <div class="space-y-3 max-h-64 overflow-y-auto pt-1">
                    <label
                        v-for="entry in catalog[section.key]"
                        :key="entry.name"
                        class="flex items-start gap-2 text-sm cursor-pointer">
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
        <UiButton
            v-if="!tracking"
            variant="primary"
            :loading="busy"
            :disabled="!selectionKnown"
            @click="createPlan"
            >查看安装计划</UiButton
        >
        <section v-if="plan && !tracking" class="border border-border rounded-panel p-4 space-y-4">
            <h3 class="font-medium">确认安装计划</h3>
            <p class="text-sm text-fg-secondary">
                这是完整集合。取消勾选的依赖不会保留在新运行版本中。
            </p>
            <ul class="text-sm space-y-1 break-all">
                <li v-for="item in plan.packages" :key="item.name">
                    {{ item.name }} <span class="text-fg-muted">{{ item.version }}</span>
                </li>
            </ul>
            <details v-if="plan.peers.length" class="text-sm">
                <summary class="cursor-pointer">必需对等依赖（{{ plan.peers.length }} 项）</summary>
                <ul class="mt-2 space-y-1 break-all">
                    <li v-for="peer in plan.peers" :key="`${peer.requestedBy}:${peer.packageName}`">
                        {{ peer.packageName }} {{ peer.range
                        }}<span class="block text-xs text-fg-muted"
                            >{{ peer.requestedBy }} 需要</span
                        >
                    </li>
                </ul>
            </details>
            <p
                v-for="recommendation in plan.recommendations"
                :key="recommendation"
                class="text-sm text-fg-secondary">
                {{ recommendation }}
            </p>
            <label v-if="privateNeeded" class="block space-y-2 text-sm">
                <span>GitHub Packages 读取授权（read:packages）</span>
                <input
                    v-model="privateToken"
                    type="password"
                    autocomplete="off"
                    spellcheck="false"
                    maxlength="512"
                    :disabled="!secureTransport"
                    class="w-full rounded-control border border-border bg-surface p-3" />
                <span class="block text-xs text-fg-muted"
                    >仅用于这次下载，提交后清空，不保存到浏览器或配置。{{
                        secureTransport ? "" : "请通过 HTTPS 或本机连接提交。"
                    }}</span
                >
            </label>
            <UiButton
                variant="primary"
                :loading="busy"
                :disabled="!!privateNeeded && (!privateToken || !secureTransport)"
                @click="install"
                >确认并安装</UiButton
            >
        </section>
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
                <UiButton v-if="pending" :loading="busy" @click="cancel">取消安装</UiButton>
                <UiButton v-if="!operation" :loading="busy" @click="install"
                    >重新提交同一操作</UiButton
                >
                <UiButton
                    v-if="operation?.phase === 'verified' && !tracking.activationRequested"
                    variant="primary"
                    :loading="busy"
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
