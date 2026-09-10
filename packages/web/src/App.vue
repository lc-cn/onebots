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
import { controlMutationBlock, workspaceReadiness } from "./control-product-state.js";
import type { Workspace } from "./control-workspace.js";
import { workspaceNavigation } from "./control-workspace.js";
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
const readiness = computed(() =>
    workspaceReadiness(
        installationCatalog.value,
        configurationSnapshot.value,
        workspaceFactsUnavailable.value,
    ),
);
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let factsRevision = 0;
let verificationRevision = 0;

function selectWorkspace(workspace: Workspace) {
    activeWorkspace.value = workspace;
    history.replaceState(null, "", `#${workspace}`);
    document.querySelector(".workspace-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
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
}

async function logout() {
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
            notice.value = `${label}请求已提交。`;
        }
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "操作结果暂不可确认，请刷新状态";
    } finally {
        busy.value = false;
    }
}

onMounted(() => {
    const hash = window.location.hash.slice(1) as Workspace;
    if (workspaceNavigation.some(item => item.id === hash)) activeWorkspace.value = hash;
    void refreshProductState();
    refreshTimer = setInterval(() => {
        if (!busy.value) void refresh();
    }, 3000);
});

onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer);
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
            :readiness="readiness"
            :mutation-block="mutationBlock"
            @command="command"
            @select="selectWorkspace" />
        <ExtensionsView
            v-show="activeWorkspace === 'extensions'"
            :client="client"
            :mutation-block="mutationBlock"
            @applied="refreshProductState" />
        <ConfigurationView
            v-show="activeWorkspace === 'configuration'"
            :client="client"
            :mutation-block="mutationBlock"
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
            @logout="logout"
            @reconnect="reconnect" />
    </ControlLayout>
</template>
