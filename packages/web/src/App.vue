<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
    ControlClient,
    ControlRequestError,
    createHttpControlTransport,
    type ControlConfigurationSnapshot,
    type ControlInstallationCatalog,
    type ControlStatus,
} from "@onebots/core/control";
import { controlMutationBlock, setupJourney } from "./control-product-state.js";
import type { Workspace } from "./control-workspace.js";
import { workspaceFromHash, workspaceHash } from "./control-workspace.js";
import ControlLayout from "./layouts/ControlLayout.vue";
import AccessView from "./views/AccessView.vue";
import ConfigurationView from "./views/ConfigurationView.vue";
import ExtensionsView from "./views/ExtensionsView.vue";
import OperationsView from "./views/OperationsView.vue";
import OverviewView from "./views/OverviewView.vue";
import PairingView from "./views/PairingView.vue";

const token = ref(localStorage.getItem("onebots.control.token") ?? "");
const code = ref("");
const state = ref<ControlStatus>();
const error = ref("");
const notice = ref("");
const busy = ref(false);
const lastUpdated = ref<Date>();
const activeWorkspace = ref<Workspace>("overview");
const configurationDirty = ref(false);
const installationCatalog = ref<ControlInstallationCatalog>();
const configurationSnapshot = ref<ControlConfigurationSnapshot>();
const workspaceFactsUnavailable = ref(false);
const pendingVerificationCount = ref<number>();
const storedTheme = localStorage.getItem("onebots.theme");
const isDark = ref(
    storedTheme
        ? storedTheme === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches,
);
document.documentElement.classList.toggle("dark", isDark.value);

const client = new ControlClient(createHttpControlTransport("", () => token.value));
const gatewayInstanceId = computed(() =>
    state.value?.gateway.actual === "running" &&
    !state.value.gateway.recoveryRequired &&
    !error.value
        ? state.value.gateway.instance?.id
        : undefined,
);
const mutationBlock = computed(() => controlMutationBlock(state.value));
const journey = computed(() =>
    setupJourney(
        installationCatalog.value,
        configurationSnapshot.value,
        state.value,
        workspaceFactsUnavailable.value,
    ),
);
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let factsRevision = 0;
let verificationRevision = 0;

function confirmConfigurationLeave() {
    return window.confirm("配置中还有未保存的本地修改。离开后这些修改会丢失，是否继续？");
}

function showWorkspace(workspace: Workspace) {
    activeWorkspace.value = workspace;
    document.querySelector(".workspace-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
}

function selectWorkspace(workspace: Workspace) {
    if (workspace !== activeWorkspace.value)
        history.pushState({ workspace }, "", workspaceHash(workspace));
    showWorkspace(workspace);
}

function restoreWorkspaceFromLocation() {
    const workspace = workspaceFromHash(window.location.hash);
    showWorkspace(workspace);
}

function protectUnsavedConfiguration(event: BeforeUnloadEvent) {
    if (!configurationDirty.value) return;
    event.preventDefault();
    event.returnValue = "";
}

function toggleTheme() {
    isDark.value = !isDark.value;
    document.documentElement.classList.toggle("dark", isDark.value);
    localStorage.setItem("onebots.theme", isDark.value ? "dark" : "light");
}

async function refresh() {
    if (!token.value) return;
    const expectedToken = token.value;
    try {
        const next = await client.status();
        if (token.value !== expectedToken) return;
        state.value = next;
        lastUpdated.value = new Date();
        error.value = "";
        void refreshVerificationSummary(
            next.gateway.actual === "running" && !next.gateway.recoveryRequired
                ? next.gateway.instance?.id
                : undefined,
        );
    } catch (cause) {
        if (token.value !== expectedToken) return;
        if (cause instanceof ControlRequestError && cause.status === 401) {
            reconnect();
            error.value = "管理会话已失效，请申请新设备码重新授权。";
            return;
        }
        error.value = cause instanceof Error ? cause.message : "无法连接管理服务";
    }
}

async function refreshWorkspaceFacts() {
    if (!token.value) return;
    const revision = ++factsRevision;
    const [catalog, configuration] = await Promise.allSettled([
        client.installationCatalog(),
        client.configurationSnapshot(),
    ]);
    if (revision !== factsRevision || !token.value) return;
    if (catalog.status === "fulfilled" && configuration.status === "fulfilled") {
        installationCatalog.value = catalog.value;
        configurationSnapshot.value = configuration.value;
        workspaceFactsUnavailable.value = false;
    } else {
        installationCatalog.value = undefined;
        configurationSnapshot.value = undefined;
        workspaceFactsUnavailable.value = true;
    }
}

async function refreshVerificationSummary(instanceId?: string) {
    const revision = ++verificationRevision;
    if (!instanceId) {
        pendingVerificationCount.value = undefined;
        return;
    }
    try {
        const snapshot = await client.verification.pending();
        if (revision !== verificationRevision || snapshot.gatewayInstanceId !== instanceId) return;
        pendingVerificationCount.value = snapshot.challenges.length;
    } catch {
        if (revision === verificationRevision) pendingVerificationCount.value = undefined;
    }
}

async function refreshProductState() {
    await Promise.all([refresh(), refreshWorkspaceFacts()]);
}

async function pair() {
    busy.value = true;
    error.value = "";
    notice.value = "";
    try {
        const result = await client.pair(code.value.trim());
        token.value = result.token;
        localStorage.setItem("onebots.control.token", result.token);
        code.value = "";
        await refreshProductState();
        notice.value = "此设备已连接到管理服务。";
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "配对失败";
    } finally {
        busy.value = false;
    }
}

function reconnect() {
    token.value = "";
    localStorage.removeItem("onebots.control.token");
    state.value = undefined;
    installationCatalog.value = undefined;
    configurationSnapshot.value = undefined;
    workspaceFactsUnavailable.value = false;
    pendingVerificationCount.value = undefined;
    code.value = "";
    error.value = "";
    notice.value = "";
    configurationDirty.value = false;
}

function requestReconnect() {
    if (configurationDirty.value && !confirmConfigurationLeave()) return;
    reconnect();
}

async function logout() {
    if (configurationDirty.value && !confirmConfigurationLeave()) return;
    busy.value = true;
    error.value = "";
    try {
        await client.logout();
        reconnect();
    } catch {
        error.value =
            "无法确认服务端会话已撤销。请重试；若凭据已失效，可清除本地凭据后申请设备码重新授权。";
    } finally {
        busy.value = false;
    }
}

async function command(action: "start" | "stop" | "restart") {
    if (mutationBlock.value) return;
    busy.value = true;
    error.value = "";
    notice.value = "";
    const label = { start: "启动网关", stop: "停止网关", restart: "重启网关" }[action];
    try {
        const result = await client.gateway(action);
        await refresh();
        if (result.status === "failed") {
            error.value = result.error ?? "操作未完成，请检查网关状态";
        } else {
            notice.value = `${label}已完成。`;
        }
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "操作结果暂不可确认，请刷新状态";
    } finally {
        busy.value = false;
    }
}

onMounted(() => {
    const workspace = workspaceFromHash(window.location.hash);
    activeWorkspace.value = workspace;
    if (window.location.hash !== workspaceHash(workspace))
        history.replaceState({ workspace }, "", workspaceHash(workspace));
    window.addEventListener("popstate", restoreWorkspaceFromLocation);
    window.addEventListener("hashchange", restoreWorkspaceFromLocation);
    window.addEventListener("beforeunload", protectUnsavedConfiguration);
    void refreshProductState();
    refreshTimer = setInterval(() => {
        if (!busy.value) void refresh();
    }, 3000);
});

onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    window.removeEventListener("popstate", restoreWorkspaceFromLocation);
    window.removeEventListener("hashchange", restoreWorkspaceFromLocation);
    window.removeEventListener("beforeunload", protectUnsavedConfiguration);
});
</script>

<template>
    <a href="#main-content" class="skip-link">跳到主要内容</a>
    <PairingView
        v-if="!token"
        v-model="code"
        :busy="busy"
        :error="error"
        :is-dark="isDark"
        @pair="pair"
        @toggle-theme="toggleTheme" />
    <ControlLayout
        v-else
        :active="activeWorkspace"
        :state="state"
        :error="error"
        :notice="notice"
        :is-dark="isDark"
        :mutation-block="mutationBlock"
        :pending-verification-count="pendingVerificationCount"
        @select="selectWorkspace"
        @refresh="refresh"
        @logout="logout"
        @toggle-theme="toggleTheme"
        @dismiss-notice="notice = ''">
        <OverviewView
            v-show="activeWorkspace === 'overview'"
            :state="state"
            :busy="busy"
            :last-updated="lastUpdated"
            :stale="!!error && !!state"
            :journey="journey"
            :mutation-block="mutationBlock"
            @command="command"
            @select="selectWorkspace" />
        <ExtensionsView
            v-show="activeWorkspace === 'extensions'"
            :client="client"
            :journey="journey"
            :mutation-block="mutationBlock"
            @select="selectWorkspace"
            @applied="refreshProductState" />
        <ConfigurationView
            v-show="activeWorkspace === 'configuration'"
            :client="client"
            :journey="journey"
            :mutation-block="mutationBlock"
            @select="selectWorkspace"
            @dirty-change="configurationDirty = $event"
            @applied="refreshProductState" />
        <OperationsView
            v-show="activeWorkspace === 'activity'"
            :client="client"
            :gateway-instance-id="gatewayInstanceId"
            :active="activeWorkspace === 'activity'"
            :mutation-block="mutationBlock" />
        <AccessView
            v-show="activeWorkspace === 'access'"
            :client="client"
            :busy="busy"
            :configuration-dirty="configurationDirty"
            @logout="logout"
            @revoked-self="reconnect"
            @reconnect="requestReconnect" />
    </ControlLayout>
</template>
