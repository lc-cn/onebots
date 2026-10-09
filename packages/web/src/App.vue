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
    accountPageFromPath,
    accountPagePath,
    accountControlFromPath,
    accountControlPath,
    extensionCategoryFromPath,
    extensionWorkspacePath,
    protocolPageFromPath,
    protocolPagePath,
    workspaceFromPath,
    workspacePath,
    type AccountPageRoute,
    type ProtocolPageRoute,
} from "./control-workspace.js";
import type {
    ConfigurationNavigationTarget,
    ConfigurationScope,
} from "./components/control-configuration-layout.js";
import ControlLayout from "./layouts/ControlLayout.vue";
import AccountsView from "./views/AccountsView.vue";
import AccountDetailView from "./views/AccountDetailView.vue";
import AccountControlView from "./views/AccountControlView.vue";
import ProtocolsView from "./views/ProtocolsView.vue";
import ProtocolDetailView from "./views/ProtocolDetailView.vue";
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
const gatewayRunning = computed<boolean | undefined>(() => {
    switch (state.value?.gateway.actual) {
        case "running":
            return true;
        case "stopped":
        case "failed":
            return false;
        default:
            return undefined;
    }
});
const statusError = ref("");
const actionError = ref("");
const error = computed(() => actionError.value || statusError.value);
const notice = ref("");
const busy = ref(false);
const lastUpdated = ref<Date>();
const activeWorkspace = ref<Workspace>("overview");
const currentLocation = () => window.location.pathname + window.location.search;
const controlledAccount = ref(accountControlFromPath(currentLocation()));
const accountPage = ref<AccountPageRoute>(accountPageFromPath(currentLocation()));
const protocolPage = ref<ProtocolPageRoute>(protocolPageFromPath(currentLocation()));
const extensionCategory = ref<ExtensionCategory>(extensionCategoryFromPath(currentLocation()));
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
    if (configurationScope.value === "accounts") return "#account-editor-target";
    if (configurationScope.value === "protocols") return "#protocol-editor-target";
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
    if (
        (workspace === "accounts" || workspace === "protocols") &&
        configurationScope.value &&
        workspace === configurationWorkspace.value &&
        configurationDirty.value &&
        !confirmConfigurationLeave()
    )
        return;
    const leavingSubpage =
        Boolean(controlledAccount.value) ||
        accountPage.value.page !== "list" ||
        protocolPage.value.page !== "list";
    controlledAccount.value = undefined;
    accountPage.value = { page: "list" };
    protocolPage.value = { page: "list" };
    if (
        workspace !== configurationWorkspace.value ||
        workspace === "accounts" ||
        workspace === "protocols"
    ) {
        configurationScope.value = undefined;
        configurationDirty.value = false;
    }
    if (workspace !== activeWorkspace.value || leavingSubpage)
        history.pushState(
            { workspace },
            "",
            workspace === "extensions"
                ? extensionWorkspacePath(extensionCategory.value)
                : workspacePath(workspace),
        );
    showWorkspace(workspace);
}

function openAccountPage(route: AccountPageRoute) {
    if (!canLeaveWorkspace("accounts")) return;
    if (
        configurationScope.value &&
        activeWorkspace.value === "accounts" &&
        configurationDirty.value &&
        !confirmConfigurationLeave()
    )
        return;
    controlledAccount.value = undefined;
    if (configurationScope.value && route.page !== "edit" && route.page !== "create") {
        configurationScope.value = undefined;
        configurationDirty.value = false;
    }
    accountPage.value = route;
    protocolPage.value = { page: "list" };
    history.pushState({ workspace: "accounts" }, "", accountPagePath(route));
    showWorkspace("accounts");
}

function openProtocolPage(route: ProtocolPageRoute) {
    if (!canLeaveWorkspace("protocols")) return;
    if (
        configurationScope.value &&
        activeWorkspace.value === "protocols" &&
        configurationDirty.value &&
        !confirmConfigurationLeave()
    )
        return;
    if (configurationScope.value && route.page !== "edit" && route.page !== "create") {
        configurationScope.value = undefined;
        configurationDirty.value = false;
    }
    protocolPage.value = route;
    accountPage.value = { page: "list" };
    history.pushState({ workspace: "protocols" }, "", protocolPagePath(route));
    showWorkspace("protocols");
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
    const path = accountControlPath({ platform, accountId });
    if (currentLocation() !== path) history.pushState({ workspace: "accounts" }, "", path);
    showWorkspace("accounts");
}

function leaveAccountControl() {
    const account = controlledAccount.value;
    if (account)
        openAccountPage({
            page: "detail",
            platform: account.platform,
            accountId: account.accountId,
        });
    else selectWorkspace("accounts");
}

function openExtensionCategory(category: ExtensionCategory) {
    if (!canLeaveWorkspace("extensions")) return;
    extensionCategory.value = category;
    const path = extensionWorkspacePath(category);
    if (currentLocation() !== path) history.pushState({ workspace: "extensions" }, "", path);
    if (configurationScope.value) {
        configurationScope.value = undefined;
        configurationDirty.value = false;
    }
    showWorkspace("extensions");
}

function restoreWorkspaceFromLocation() {
    const workspace = workspaceFromPath(currentLocation());
    const nextAccountPage = accountPageFromPath(currentLocation());
    const nextProtocolPage = protocolPageFromPath(currentLocation());
    const routeScope =
        nextAccountPage.page === "edit" || nextAccountPage.page === "create"
            ? "accounts"
            : nextProtocolPage.page === "edit" || nextProtocolPage.page === "create"
              ? "protocols"
              : undefined;
    if (
        !canLeaveWorkspace(workspace) ||
        (configurationScope.value &&
            workspace === configurationWorkspace.value &&
            configurationScope.value !== routeScope &&
            configurationDirty.value &&
            !confirmConfigurationLeave())
    ) {
        history.replaceState(
            { workspace: activeWorkspace.value },
            "",
            controlledAccount.value
                ? accountControlPath(controlledAccount.value)
                : activeWorkspace.value === "accounts"
                  ? accountPagePath(accountPage.value)
                  : activeWorkspace.value === "protocols"
                    ? protocolPagePath(protocolPage.value)
                    : workspacePath(activeWorkspace.value),
        );
        return;
    }
    if (workspace !== configurationWorkspace.value || (configurationScope.value && !routeScope)) {
        configurationScope.value = undefined;
        configurationDirty.value = false;
    }
    if (workspace === "extensions")
        extensionCategory.value = extensionCategoryFromPath(currentLocation());
    controlledAccount.value = accountControlFromPath(currentLocation());
    accountPage.value = nextAccountPage;
    protocolPage.value = nextProtocolPage;
    if (routeScope) {
        configurationScope.value = routeScope;
        configurationTarget.value = {
            platform:
                (routeScope === "accounts" ? accountPage.value : protocolPage.value).platform ?? "",
            accountId:
                (routeScope === "accounts" ? accountPage.value : protocolPage.value).accountId ??
                "",
            protocolKey: routeScope === "protocols" ? protocolPage.value.protocolKey : undefined,
            defaultScope: routeScope === "protocols" ? protocolPage.value.defaultScope : undefined,
            mode:
                (routeScope === "accounts" ? accountPage.value : protocolPage.value).page === "edit"
                    ? "edit"
                    : "create",
            revision: ++configurationTargetRevision,
        };
    }
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
    defaultScope = false,
): boolean {
    const workspace: Workspace = scope === "runtime" ? "system" : scope;
    if (!canLeaveWorkspace(workspace)) return false;
    configurationScope.value = scope;
    configurationTarget.value = {
        platform,
        accountId,
        protocolKey,
        defaultScope,
        mode:
            scope === "accounts"
                ? accountId
                    ? "edit"
                    : "create"
                : scope === "protocols"
                  ? accountId && protocolKey
                      ? "edit"
                      : "create"
                  : undefined,
        revision: ++configurationTargetRevision,
    };
    if (scope === "accounts")
        accountPage.value = accountId
            ? { page: "edit", platform, accountId }
            : { page: "create", ...(platform ? { platform } : {}) };
    if (scope === "protocols")
        protocolPage.value =
            platform && accountId && protocolKey
                ? { page: "edit", platform, accountId, protocolKey }
                : { page: "create", platform, accountId, protocolKey, defaultScope };
    if (scope === "accounts") protocolPage.value = { page: "list" };
    if (scope === "protocols") accountPage.value = { page: "list" };
    if (scope === "runtime")
        systemTarget.value = { section: "runtime", revision: ++systemTargetRevision };
    history.pushState(
        { workspace },
        "",
        scope === "accounts"
            ? accountPagePath(accountPage.value)
            : scope === "protocols"
              ? protocolPagePath(protocolPage.value)
              : workspacePath(workspace),
    );
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
        mode: "edit",
        action: "remove",
        revision: ++configurationTargetRevision,
    };
}

function moveConfigurationScope(scope: ConfigurationScope, path: string[]) {
    // 校验已把本地修改保存到同一草稿；移动唯一编辑实例，不重建草稿。
    configurationScope.value = scope;
    const workspace: Workspace = scope === "runtime" ? "system" : scope;
    const accountKey = path[0];
    const adapter = Object.keys(configurationSnapshot.value?.schemas.adapters ?? {})
        .sort((left, right) => right.length - left.length)
        .find(name => accountKey?.startsWith(`${name}.`));
    const platform = adapter ?? accountKey?.split(".")[0] ?? "";
    const accountId = adapter
        ? accountKey.slice(adapter.length + 1)
        : (accountKey?.slice(platform.length + 1) ?? "");
    if (scope === "accounts")
        accountPage.value =
            platform && accountId ? { page: "edit", platform, accountId } : { page: "create" };
    if (scope === "protocols")
        protocolPage.value =
            accountKey === "general" && path[1]
                ? { page: "create", protocolKey: path[1], defaultScope: true }
                : platform && accountId && path[1]
                  ? { page: "edit", platform, accountId, protocolKey: path[1] }
                  : { page: "create" };
    const route = scope === "accounts" ? accountPage.value : protocolPage.value;
    configurationTarget.value = {
        platform: scope === "runtime" ? "" : (route.platform ?? ""),
        accountId: scope === "runtime" ? "" : (route.accountId ?? ""),
        protocolKey: scope === "protocols" ? protocolPage.value.protocolKey : undefined,
        defaultScope: scope === "protocols" ? protocolPage.value.defaultScope : undefined,
        mode:
            scope === "runtime"
                ? undefined
                : scope === "accounts"
                  ? accountPage.value.page === "edit"
                      ? "edit"
                      : "create"
                  : protocolPage.value.page === "edit"
                    ? "edit"
                    : "create",
        revision: ++configurationTargetRevision,
    };
    if (scope === "runtime")
        systemTarget.value = { section: "runtime", revision: ++systemTargetRevision };
    history.pushState(
        { workspace },
        "",
        scope === "accounts"
            ? accountPagePath(accountPage.value)
            : scope === "protocols"
              ? protocolPagePath(protocolPage.value)
              : workspacePath(workspace),
    );
    showWorkspace(workspace);
}

function closeConfiguration() {
    if (configurationDirty.value && !confirmConfigurationLeave()) return;
    const removed = configurationTarget.value?.action === "remove";
    configurationScope.value = undefined;
    configurationTarget.value = undefined;
    configurationDirty.value = false;
    if (activeWorkspace.value === "accounts")
        openAccountPage(
            !removed && accountPage.value.page === "edit"
                ? { ...accountPage.value, page: "detail" }
                : { page: "list" },
        );
    if (activeWorkspace.value === "protocols")
        openProtocolPage(
            !removed && protocolPage.value.page === "edit"
                ? { ...protocolPage.value, page: "detail" }
                : { page: "list" },
        );
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
    const workspace = workspaceFromPath(currentLocation());
    activeWorkspace.value = workspace;
    extensionCategory.value = extensionCategoryFromPath(currentLocation());
    controlledAccount.value = accountControlFromPath(currentLocation());
    accountPage.value = accountPageFromPath(currentLocation());
    protocolPage.value = protocolPageFromPath(currentLocation());
    if (accountPage.value.page === "edit" || accountPage.value.page === "create") {
        configurationScope.value = "accounts";
        configurationTarget.value = {
            platform: accountPage.value.platform ?? "",
            accountId: accountPage.value.accountId ?? "",
            mode: accountPage.value.page === "edit" ? "edit" : "create",
            revision: ++configurationTargetRevision,
        };
    }
    if (protocolPage.value.page === "edit" || protocolPage.value.page === "create") {
        configurationScope.value = "protocols";
        configurationTarget.value = {
            platform: protocolPage.value.platform ?? "",
            accountId: protocolPage.value.accountId ?? "",
            protocolKey: protocolPage.value.protocolKey,
            defaultScope: protocolPage.value.defaultScope,
            mode: protocolPage.value.page === "edit" ? "edit" : "create",
            revision: ++configurationTargetRevision,
        };
    }
    const canonicalPath =
        workspace === "extensions"
            ? extensionWorkspacePath(extensionCategory.value)
            : controlledAccount.value
              ? accountControlPath(controlledAccount.value)
              : workspace === "accounts"
                ? accountPagePath(accountPage.value)
                : workspace === "protocols"
                  ? protocolPagePath(protocolPage.value)
                  : workspacePath(workspace);
    if (currentLocation() !== canonicalPath) history.replaceState({ workspace }, "", canonicalPath);
    window.addEventListener("popstate", restoreWorkspaceFromLocation);
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
            :gateway-running="gatewayRunning"
            @applied="refreshProductState"
            @category-change="openExtensionCategory" />
        <AccountsView
            v-show="
                activeWorkspace === 'accounts' && !controlledAccount && accountPage.page === 'list'
            "
            :configuration="configurationSnapshot"
            :status="state"
            :catalog="installationCatalog"
            :configuration-unavailable="configurationUnavailable"
            @configure="(platform, accountId) => openConfiguration('accounts', platform, accountId)"
            @detail="
                (platform, accountId) => openAccountPage({ page: 'detail', platform, accountId })
            "
            @select-extensions="openExtensionCategory('platform')" />
        <AccountDetailView
            v-if="
                activeWorkspace === 'accounts' &&
                accountPage.page === 'detail' &&
                accountPage.platform &&
                accountPage.accountId
            "
            :platform="accountPage.platform"
            :account-id="accountPage.accountId"
            :configuration="configurationSnapshot"
            :status="state"
            :catalog="installationCatalog"
            @back="openAccountPage({ page: 'list' })"
            @edit="openConfiguration('accounts', accountPage.platform!, accountPage.accountId!)"
            @remove="
                removeConfigurationItem('accounts', accountPage.platform!, accountPage.accountId!)
            "
            @control="openAccountControl(accountPage.platform!, accountPage.accountId!)"
            @protocol="
                protocolKey =>
                    openProtocolPage({
                        page: 'detail',
                        platform: accountPage.platform,
                        accountId: accountPage.accountId,
                        protocolKey,
                    })
            "
            @add-protocol="
                openConfiguration('protocols', accountPage.platform, accountPage.accountId, '')
            " />
        <section
            v-show="
                activeWorkspace === 'accounts' &&
                (accountPage.page === 'create' || accountPage.page === 'edit')
            "
            class="workspace-view entity-editor-page"
            aria-label="账号设置">
            <button type="button" class="entity-back" @click="closeConfiguration">
                ← 返回账号
            </button>
            <header class="page-heading">
                <div>
                    <h1>{{ accountPage.page === "create" ? "添加账号" : "编辑账号" }}</h1>
                    <p v-if="accountPage.platform">
                        {{ accountPage.platform
                        }}{{ accountPage.accountId ? ` · ${accountPage.accountId}` : "" }}
                    </p>
                </div>
            </header>
            <div id="account-editor-target"></div>
        </section>
        <AccountControlView
            v-if="activeWorkspace === 'accounts' && controlledAccount"
            :client="client"
            :platform="controlledAccount.platform"
            :account-id="controlledAccount.accountId"
            :status="state"
            :status-error="statusError"
            :configuration="configurationSnapshot"
            :catalog="installationCatalog"
            @back="leaveAccountControl"
            @retry-status="refresh"
            @history-settings="openChatHistorySettings" />
        <ProtocolsView
            v-show="activeWorkspace === 'protocols' && protocolPage.page === 'list'"
            :configuration="configurationSnapshot"
            :status="state"
            :catalog="installationCatalog"
            :configuration-unavailable="configurationUnavailable"
            @configure="
                (platform, accountId, protocolKey) =>
                    openConfiguration('protocols', platform, accountId, protocolKey)
            "
            @defaults="protocolKey => openConfiguration('protocols', '', '', protocolKey, true)"
            @detail="
                (platform, accountId, protocolKey) =>
                    openProtocolPage({ page: 'detail', platform, accountId, protocolKey })
            "
            @show-accounts="selectWorkspace('accounts')"
            @select-extensions="openExtensionCategory('protocol')" />
        <ProtocolDetailView
            v-if="
                activeWorkspace === 'protocols' &&
                protocolPage.page === 'detail' &&
                protocolPage.platform &&
                protocolPage.accountId &&
                protocolPage.protocolKey
            "
            :platform="protocolPage.platform"
            :account-id="protocolPage.accountId"
            :protocol-key="protocolPage.protocolKey"
            :configuration="configurationSnapshot"
            :status="state"
            :catalog="installationCatalog"
            @back="openProtocolPage({ page: 'list' })"
            @account="
                openAccountPage({
                    page: 'detail',
                    platform: protocolPage.platform,
                    accountId: protocolPage.accountId,
                })
            "
            @edit="
                openConfiguration(
                    'protocols',
                    protocolPage.platform!,
                    protocolPage.accountId!,
                    protocolPage.protocolKey!,
                )
            "
            @remove="
                removeConfigurationItem(
                    'protocols',
                    protocolPage.platform!,
                    protocolPage.accountId!,
                    protocolPage.protocolKey!,
                )
            " />
        <section
            v-show="
                activeWorkspace === 'protocols' &&
                (protocolPage.page === 'create' || protocolPage.page === 'edit')
            "
            class="workspace-view entity-editor-page"
            aria-label="协议设置">
            <button type="button" class="entity-back" @click="closeConfiguration">
                ← 返回协议
            </button>
            <header class="page-heading">
                <div>
                    <h1>{{ protocolPage.page === "create" ? "添加协议出口" : "编辑协议出口" }}</h1>
                    <p v-if="protocolPage.accountId">
                        {{ protocolPage.platform }} · {{ protocolPage.accountId }}
                    </p>
                </div>
            </header>
            <div id="protocol-editor-target"></div>
        </section>
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
                :gateway-running="gatewayRunning"
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
