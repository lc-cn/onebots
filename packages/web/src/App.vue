<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import {
    ControlClient,
    ControlRequestError,
    createHttpControlTransport,
    type ControlConfigurationSnapshot,
    type ControlInstallationCatalog,
    type ControlStatus,
} from "@onebots/core/control";
import { controlMutationBlock, setupJourney } from "./control-product-state.js";
import type { ExtensionCategory, Workspace } from "./control-workspace.js";
import {
    accountControlFromHash,
    accountControlHash,
    extensionCategoryFromHash,
    extensionWorkspaceHash,
    workspaceFromHash,
    workspaceHash,
} from "./control-workspace.js";
import type {
    ConfigurationNavigationTarget,
    ConfigurationScope,
} from "./components/control-configuration-layout.js";
import ControlLayout from "./layouts/ControlLayout.vue";
import AccountsView from "./views/AccountsView.vue";
import AccountControlView from "./views/AccountControlView.vue";
import ProtocolsView from "./views/ProtocolsView.vue";
import ConfigurationView from "./views/ConfigurationView.vue";
import ExtensionsView from "./views/ExtensionsView.vue";
import OperationsView from "./views/OperationsView.vue";
import OverviewView from "./views/OverviewView.vue";
import PairingView from "./views/PairingView.vue";
import TerminalView from "./views/TerminalView.vue";
import SystemView from "./views/SystemView.vue";
import TodoView from "./views/TodoView.vue";
import type { NotificationSnapshot } from "./notification-model.js";
import FeatureIntro from "./components/FeatureIntro.vue";
import { browserAccountSendStorage, writePendingAccountSends } from "./account-send-recovery.js";

const token = ref(localStorage.getItem("onebots.control.token") ?? "");
const code = ref("");
const state = ref<ControlStatus>();
const statusError = ref("");
const actionError = ref("");
const error = computed(() => actionError.value || statusError.value);
const notice = ref("");
const busy = ref(false);
const lastUpdated = ref<Date>();
const activeWorkspace = ref<Workspace>("overview");
const controlledAccount = ref(accountControlFromHash(window.location.hash));
const extensionCategory = ref<ExtensionCategory>(extensionCategoryFromHash(window.location.hash));
const configurationDirty = ref(false);
const notificationsDirty = ref(false);
const installationCatalog = ref<ControlInstallationCatalog>();
const configurationSnapshot = ref<ControlConfigurationSnapshot>();
const workspaceFactsUnavailable = ref(false);
const configurationUnavailable = ref(false);
const pendingVerificationCount = ref<number>();
const notificationSnapshot = ref<NotificationSnapshot>();
const configurationTarget = ref<ConfigurationNavigationTarget>();
let configurationTargetRevision = 0;
const configurationScope = ref<ConfigurationScope>();
const protocolAccountFilter = ref<{ platform: string; accountId: string }>();
const systemTarget = ref<{
    section: "notifications" | "history" | "runtime";
    notificationSection?: "channels" | "history";
    revision: number;
}>();
let systemTargetRevision = 0;
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
    !statusError.value
        ? state.value.gateway.instance?.id
        : undefined,
);
const notificationAccounts = computed(() =>
    Array.from(
        new Set([
            ...(state.value?.accounts?.items.map(item => `${item.platform}/${item.accountId}`) ??
                []),
            ...Object.keys(configurationSnapshot.value?.document ?? {})
                .filter(key => /^[^.]+\..+/.test(key))
                .map(key => key.replace(".", "/")),
        ]),
    ).sort(),
);
const mutationBlock = computed(() => controlMutationBlock(state.value));
const configurationWorkspace = computed<Workspace | undefined>(() => {
    if (configurationScope.value === "runtime") return "system";
    return configurationScope.value;
});
const configurationDestination = computed(() => {
    if (configurationScope.value === "accounts") return "#account-configuration-target";
    if (configurationScope.value === "protocols") return "#protocol-configuration-target";
    return "#runtime-configuration-target";
});
const journey = computed(() =>
    setupJourney(
        installationCatalog.value,
        configurationSnapshot.value,
        state.value,
        workspaceFactsUnavailable.value,
    ),
);
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let notificationTimer: ReturnType<typeof setInterval> | undefined;
let lastSessionMaintenance = 0;
let sessionMaintenancePending = false;
let factsRevision = 0;
let verificationRevision = 0;

function confirmConfigurationLeave() {
    return window.confirm("配置中还有未保存的本地修改。离开后这些修改会丢失，是否继续？");
}

function showWorkspace(workspace: Workspace) {
    activeWorkspace.value = workspace;
    document.querySelector(".workspace-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
}

function canLeaveWorkspace(workspace: Workspace): boolean {
    if (
        configurationScope.value &&
        workspace !== configurationWorkspace.value &&
        configurationDirty.value &&
        !confirmConfigurationLeave()
    )
        return false;
    if (
        activeWorkspace.value === "system" &&
        workspace !== "system" &&
        notificationsDirty.value &&
        !window.confirm("通知配置尚未保存，确定离开？")
    )
        return false;
    return true;
}

function selectWorkspace(workspace: Workspace) {
    if (!canLeaveWorkspace(workspace)) return;
    const leavingControl = Boolean(controlledAccount.value);
    controlledAccount.value = undefined;
    if (workspace !== configurationWorkspace.value) {
        configurationScope.value = undefined;
        configurationDirty.value = false;
    }
    if (workspace === "protocols") protocolAccountFilter.value = undefined;
    if (workspace !== activeWorkspace.value || leavingControl)
        history.pushState(
            { workspace },
            "",
            workspace === "extensions"
                ? extensionWorkspaceHash(extensionCategory.value)
                : workspaceHash(workspace),
        );
    showWorkspace(workspace);
}

function openAccountControl(platform: string, accountId: string) {
    if (!canLeaveWorkspace("accounts")) return;
    if (
        !state.value?.accounts?.items.some(
            item =>
                item.platform === platform &&
                item.accountId === accountId &&
                item.status === "online",
        )
    )
        return;
    controlledAccount.value = { platform, accountId };
    const hash = accountControlHash({ platform, accountId });
    if (window.location.hash !== hash) history.pushState({ workspace: "accounts" }, "", hash);
    showWorkspace("accounts");
}

function openExtensionCategory(category: ExtensionCategory) {
    if (!canLeaveWorkspace("extensions")) return;
    extensionCategory.value = category;
    const hash = extensionWorkspaceHash(category);
    if (window.location.hash !== hash) history.pushState({ workspace: "extensions" }, "", hash);
    if (configurationScope.value) {
        configurationScope.value = undefined;
        configurationDirty.value = false;
    }
    showWorkspace("extensions");
}

function restoreWorkspaceFromLocation() {
    const workspace = workspaceFromHash(window.location.hash);
    if (!canLeaveWorkspace(workspace)) {
        history.replaceState(
            { workspace: activeWorkspace.value },
            "",
            workspaceHash(activeWorkspace.value),
        );
        return;
    }
    if (workspace !== configurationWorkspace.value) {
        configurationScope.value = undefined;
        configurationDirty.value = false;
    }
    if (workspace === "protocols") protocolAccountFilter.value = undefined;
    if (workspace === "extensions")
        extensionCategory.value = extensionCategoryFromHash(window.location.hash);
    controlledAccount.value = accountControlFromHash(window.location.hash);
    showWorkspace(workspace);
}

function protectUnsavedConfiguration(event: BeforeUnloadEvent) {
    if (!configurationDirty.value && !notificationsDirty.value) return;
    event.preventDefault();
    event.returnValue = "";
}

function openConnections() {
    selectWorkspace("protocols");
}

function openNotifications(notificationSection: "channels" | "history" = "channels") {
    systemTarget.value = {
        section: "notifications",
        notificationSection,
        revision: ++systemTargetRevision,
    };
    selectWorkspace("system");
}

function openChatHistorySettings() {
    systemTarget.value = { section: "history", revision: ++systemTargetRevision };
    selectWorkspace("system");
}

function openConfiguration(
    scope: ConfigurationScope,
    platform = "",
    accountId = "",
    protocolKey?: string,
): boolean {
    const workspace: Workspace = scope === "runtime" ? "system" : scope;
    if (!canLeaveWorkspace(workspace)) return false;
    configurationScope.value = scope;
    configurationTarget.value = {
        platform,
        accountId,
        protocolKey,
        revision: ++configurationTargetRevision,
    };
    if (scope === "runtime")
        systemTarget.value = { section: "runtime", revision: ++systemTargetRevision };
    if (workspace !== activeWorkspace.value)
        history.pushState({ workspace }, "", workspaceHash(workspace));
    showWorkspace(workspace);
    void nextTick(() =>
        document.querySelector(configurationDestination.value)?.scrollIntoView({
            behavior: "smooth",
            block: "start",
        }),
    );
    return true;
}

function removeConfigurationItem(
    scope: "accounts" | "protocols",
    platform: string,
    accountId: string,
    protocolKey?: string,
) {
    if (configurationDirty.value) {
        window.alert("请先保存或放弃当前未保存的字段修改，再删除。");
        return;
    }
    const label = protocolKey
        ? `${platform} · ${accountId} 的 ${protocolKey} 协议出口`
        : `${platform} · ${accountId} 账号及其协议出口`;
    if (!window.confirm(`确定从配置草稿中删除 ${label} 吗？还需点击“保存”才会生效。`)) return;
    if (!openConfiguration(scope, platform, accountId, protocolKey)) return;
    configurationTarget.value = {
        platform,
        accountId,
        protocolKey,
        action: "remove",
        revision: ++configurationTargetRevision,
    };
}

function moveConfigurationScope(scope: ConfigurationScope) {
    // 校验已把本地修改保存到同一草稿；移动唯一编辑实例，不重建草稿。
    configurationScope.value = scope;
    const workspace: Workspace = scope === "runtime" ? "system" : scope;
    if (scope === "runtime")
        systemTarget.value = { section: "runtime", revision: ++systemTargetRevision };
    if (workspace !== activeWorkspace.value)
        history.pushState({ workspace }, "", workspaceHash(workspace));
    showWorkspace(workspace);
}

function closeConfiguration() {
    if (configurationDirty.value && !confirmConfigurationLeave()) return;
    configurationScope.value = undefined;
    configurationTarget.value = undefined;
    configurationDirty.value = false;
}

function openAccountProtocols(platform: string, accountId: string) {
    if (!canLeaveWorkspace("protocols")) return;
    configurationScope.value = undefined;
    configurationDirty.value = false;
    configurationTarget.value = undefined;
    protocolAccountFilter.value = { platform, accountId };
    if (activeWorkspace.value !== "protocols")
        history.pushState({ workspace: "protocols" }, "", workspaceHash("protocols"));
    showWorkspace("protocols");
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
        statusError.value = "";
        void maintainSession(expectedToken);
        void refreshVerificationSummary(
            next.gateway.actual === "running" && !next.gateway.recoveryRequired
                ? next.gateway.instance?.id
                : undefined,
        );
    } catch (cause) {
        if (token.value !== expectedToken) return;
        if (cause instanceof ControlRequestError && cause.status === 401) {
            reconnect();
            statusError.value = "管理会话已失效，请申请新设备码重新授权。";
            return;
        }
        statusError.value = cause instanceof Error ? cause.message : "无法连接管理服务";
    }
}

async function maintainSession(expectedToken: string) {
    if (sessionMaintenancePending || Date.now() - lastSessionMaintenance < 10 * 60_000) return;
    sessionMaintenancePending = true;
    lastSessionMaintenance = Date.now();
    try {
        const policy = await client.sessionPolicy();
        if (token.value === expectedToken && policy.autoRenew) await client.renewSession();
    } catch {
        // 续期失败不应覆盖当前页面状态；下一次检查仍会重试。
        lastSessionMaintenance = 0;
    } finally {
        sessionMaintenancePending = false;
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
    if (catalog.status === "fulfilled") installationCatalog.value = catalog.value;
    if (configuration.status === "fulfilled") configurationSnapshot.value = configuration.value;
    configurationUnavailable.value = configuration.status === "rejected";
    workspaceFactsUnavailable.value =
        catalog.status === "rejected" || configuration.status === "rejected";
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
    await Promise.all([refresh(), refreshWorkspaceFacts(), refreshNotifications()]);
}

async function refreshNotifications() {
    if (!token.value) return;
    const expectedToken = token.value;
    try {
        const response = await fetch("/api/control/notifications", {
            headers: { authorization: `Bearer ${expectedToken}` },
        });
        if (!response.ok) throw new Error("通知状态暂不可用");
        const snapshot = (await response.json()) as NotificationSnapshot;
        if (token.value === expectedToken) notificationSnapshot.value = snapshot;
    } catch {
        if (token.value === expectedToken) notificationSnapshot.value = undefined;
    }
}

async function pair() {
    busy.value = true;
    actionError.value = "";
    statusError.value = "";
    notice.value = "";
    try {
        const result = await client.pair(code.value.trim());
        token.value = result.token;
        localStorage.setItem("onebots.control.token", result.token);
        code.value = "";
        await refreshProductState();
        notice.value = "此设备已连接到管理服务。";
    } catch (cause) {
        actionError.value = cause instanceof Error ? cause.message : "配对失败";
    } finally {
        busy.value = false;
    }
}

function reconnect() {
    writePendingAccountSends(browserAccountSendStorage(), new Map());
    token.value = "";
    localStorage.removeItem("onebots.control.token");
    state.value = undefined;
    installationCatalog.value = undefined;
    configurationSnapshot.value = undefined;
    workspaceFactsUnavailable.value = false;
    configurationUnavailable.value = false;
    pendingVerificationCount.value = undefined;
    notificationSnapshot.value = undefined;
    code.value = "";
    actionError.value = "";
    statusError.value = "";
    notice.value = "";
    configurationDirty.value = false;
    configurationScope.value = undefined;
    configurationTarget.value = undefined;
    protocolAccountFilter.value = undefined;
    notificationsDirty.value = false;
}

function requestReconnect() {
    if (configurationDirty.value && !confirmConfigurationLeave()) return;
    reconnect();
}

async function logout() {
    if (configurationDirty.value && !confirmConfigurationLeave()) return;
    busy.value = true;
    actionError.value = "";
    try {
        await client.logout();
        reconnect();
    } catch {
        actionError.value =
            "无法确认服务端会话已撤销。请重试；若凭据已失效，可清除本地凭据后申请设备码重新授权。";
    } finally {
        busy.value = false;
    }
}

async function command(action: "start" | "stop" | "restart") {
    if (mutationBlock.value) return;
    busy.value = true;
    actionError.value = "";
    notice.value = "";
    const label = { start: "启动网关", stop: "停止网关", restart: "重启网关" }[action];
    try {
        const result = await client.gateway(action);
        await refresh();
        if (result.status === "failed") {
            actionError.value = result.error ?? "操作未完成，请检查网关状态";
        } else {
            notice.value = `${label}已完成。`;
        }
    } catch (cause) {
        actionError.value =
            cause instanceof Error ? cause.message : "操作结果暂不可确认，请刷新状态";
    } finally {
        busy.value = false;
    }
}

onMounted(() => {
    const workspace = workspaceFromHash(window.location.hash);
    activeWorkspace.value = workspace;
    extensionCategory.value = extensionCategoryFromHash(window.location.hash);
    controlledAccount.value = accountControlFromHash(window.location.hash);
    const canonicalHash =
        workspace === "extensions"
            ? extensionWorkspaceHash(extensionCategory.value)
            : controlledAccount.value
              ? accountControlHash(controlledAccount.value)
              : workspaceHash(workspace);
    if (window.location.hash !== canonicalHash)
        history.replaceState({ workspace }, "", canonicalHash);
    window.addEventListener("popstate", restoreWorkspaceFromLocation);
    window.addEventListener("hashchange", restoreWorkspaceFromLocation);
    window.addEventListener("beforeunload", protectUnsavedConfiguration);
    void refreshProductState();
    refreshTimer = setInterval(() => {
        if (!busy.value) void refresh();
    }, 3000);
    notificationTimer = setInterval(() => void refreshNotifications(), 30_000);
});

onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (notificationTimer) clearInterval(notificationTimer);
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
        :status-error="statusError"
        :action-error="actionError"
        :inline-status-error="activeWorkspace === 'accounts' && !!controlledAccount"
        :notice="notice"
        :is-dark="isDark"
        :mutation-block="mutationBlock"
        :pending-verification-count="pendingVerificationCount"
        @select="selectWorkspace"
        @refresh="refresh"
        @logout="logout"
        @toggle-theme="toggleTheme"
        @dismiss-error="actionError = ''"
        @dismiss-notice="notice = ''">
        <OverviewView
            v-show="activeWorkspace === 'overview'"
            :state="state"
            :busy="busy"
            :last-updated="lastUpdated"
            :stale="!!statusError && !!state"
            :journey="journey"
            :mutation-block="mutationBlock"
            :configuration="configurationSnapshot"
            :pending-verification-count="pendingVerificationCount"
            :notification-snapshot="notificationSnapshot"
            @command="command"
            @select="selectWorkspace"
            @connections="openConnections"
            @notifications="openNotifications" />
        <ExtensionsView
            v-show="activeWorkspace === 'extensions'"
            :client="client"
            :category="extensionCategory"
            :mutation-block="mutationBlock"
            :configuration="configurationSnapshot"
            :status="state"
            :gateway-running="state?.gateway.actual === 'running'"
            @applied="refreshProductState"
            @category-change="openExtensionCategory" />
        <AccountsView
            v-show="activeWorkspace === 'accounts' && !controlledAccount"
            :configuration="configurationSnapshot"
            :status="state"
            :catalog="installationCatalog"
            :configuration-unavailable="configurationUnavailable"
            @configure="(platform, accountId) => openConfiguration('accounts', platform, accountId)"
            @show-protocols="openAccountProtocols"
            @remove="
                (platform, accountId) => removeConfigurationItem('accounts', platform, accountId)
            "
            @control="openAccountControl"
            @select-extensions="openExtensionCategory('platform')" />
        <AccountControlView
            v-if="activeWorkspace === 'accounts' && controlledAccount"
            :client="client"
            :platform="controlledAccount.platform"
            :account-id="controlledAccount.accountId"
            :status="state"
            :status-error="statusError"
            :configuration="configurationSnapshot"
            :catalog="installationCatalog"
            @back="selectWorkspace('accounts')"
            @retry-status="refresh"
            @history-settings="openChatHistorySettings" />
        <ProtocolsView
            v-show="activeWorkspace === 'protocols'"
            :configuration="configurationSnapshot"
            :status="state"
            :catalog="installationCatalog"
            :configuration-unavailable="configurationUnavailable"
            :focused-account="protocolAccountFilter"
            @configure="
                (platform, accountId, protocolKey) =>
                    openConfiguration('protocols', platform, accountId, protocolKey)
            "
            @configure-account="
                (platform, accountId) => openConfiguration('accounts', platform, accountId)
            "
            @remove="
                (platform, accountId, protocolKey) =>
                    removeConfigurationItem('protocols', platform, accountId, protocolKey)
            "
            @show-accounts="selectWorkspace('accounts')"
            @clear-account="protocolAccountFilter = undefined"
            @select-extensions="openExtensionCategory('protocol')" />
        <OperationsView
            v-show="activeWorkspace === 'activity'"
            :client="client"
            :gateway-instance-id="gatewayInstanceId"
            :active="activeWorkspace === 'activity'" />
        <TodoView
            v-show="activeWorkspace === 'todo'"
            :client="client"
            :gateway-instance-id="gatewayInstanceId"
            :active="activeWorkspace === 'todo'"
            :mutation-block="mutationBlock" />
        <TerminalView
            v-show="activeWorkspace === 'terminal'"
            :token="token"
            :manager-id="state?.manager.id"
            :manager-version="state?.manager.version"
            :active="activeWorkspace === 'terminal'"
            @back="selectWorkspace('system')" />
        <SystemView
            v-show="activeWorkspace === 'system'"
            :navigation-target="systemTarget"
            :client="client"
            :token="token"
            :active="activeWorkspace === 'system'"
            :accounts="notificationAccounts"
            :runtime-editor-open="configurationScope === 'runtime'"
            :busy="busy"
            :configuration-dirty="configurationDirty"
            @logout="logout"
            @revoked-self="reconnect"
            @reconnect="requestReconnect"
            @notifications-dirty-change="notificationsDirty = $event"
            @notifications-updated="refreshNotifications"
            @open-runtime-configuration="openConfiguration('runtime')"
            @select-terminal="selectWorkspace('terminal')" />
        <!-- 只挂载一份编辑器，跨账号、协议和系统页面移动时保留同一草稿与操作身份。 -->
        <Teleport v-if="configurationScope" :to="configurationDestination">
            <ConfigurationView
                :client="client"
                :mutation-block="mutationBlock"
                :gateway-running="state?.gateway.actual === 'running'"
                :target="configurationTarget"
                :scope="configurationScope"
                @select="selectWorkspace"
                @navigate-scope="moveConfigurationScope"
                @close="closeConfiguration"
                @dirty-change="configurationDirty = $event"
                @applied="refreshProductState" />
        </Teleport>
        <FeatureIntro v-if="!controlledAccount" :active="activeWorkspace" />
    </ControlLayout>
</template>
