import { ref, onMounted, onUnmounted, computed } from "vue";
import type { AdapterInfo, SystemInfo } from "../types";
import { buildApiUrl } from "../config";
import { authFetch } from "./useAuth";
import {
    openAuthenticatedEventStream,
    type AuthenticatedEventStream,
} from "../authenticated-event-stream.js";
import { reportClientError } from "../client-diagnostics";
import {
    pendingReadinessProbe,
    probeReadiness,
    type ServiceProbeResult,
} from "../utils/service-probes.js";
import {
    buildBotLifecycleActionRequestInit,
    parseBotLifecycleActionResponse,
    type BotLifecycleActionResult,
} from "../bot-lifecycle-action.js";
import { parseAdapterInventory } from "../adapter-inventory.js";
import {
    parseManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "../management-evidence-identity.js";
import { parseSystemInfoSnapshot } from "../system-info.js";
import { readManagementJsonResponse } from "../management-response.js";

export interface UseApiResources {
    adapters?: boolean;
    systemInfo?: boolean;
    readiness?: boolean;
}

export function useApi(resources: UseApiResources = {}) {
    const enabled = {
        adapters: resources.adapters !== false,
        systemInfo: resources.systemInfo !== false,
        readiness: resources.readiness !== false,
    };
    const adapters = ref<AdapterInfo[]>([]);
    const adapterInventoryIdentity = ref<ManagementEvidenceIdentity | null>(null);
    const adapterInventoryStatus = ref<"loading" | "ready" | "unavailable">("loading");
    const adapterInventoryError = ref("");
    const systemInfo = ref<SystemInfo | null>(null);
    const systemInfoIdentity = ref<ManagementEvidenceIdentity | null>(null);
    const systemInfoStatus = ref<"loading" | "ready" | "unavailable">("loading");
    const systemInfoError = ref("");
    const logs = ref<string[]>([]);
    const readinessProbe = ref<ServiceProbeResult>(pendingReadinessProbe());

    let logsEventSource: AuthenticatedEventStream | null = null;

    const totalBotCount = computed(() => {
        return adapters.value.reduce((acc, adapter) => acc + adapter.accounts.length, 0);
    });

    const fetchAdapters = async () => {
        try {
            const response = await authFetch(buildApiUrl("/api/adapters"), { cache: "no-store" });
            if (!response.ok) throw new Error(`账号运行态请求失败（HTTP ${response.status}）`);
            const nextIdentity = parseManagementEvidenceIdentity(response);
            const nextAdapters = parseAdapterInventory(await readManagementJsonResponse(response));
            adapterInventoryIdentity.value = nextIdentity;
            adapters.value = nextAdapters;
            adapterInventoryStatus.value = "ready";
            adapterInventoryError.value = "";
        } catch (error) {
            adapterInventoryStatus.value = "unavailable";
            adapterInventoryError.value =
                error instanceof Error ? error.message : "账号运行态请求失败";
            reportClientError("获取适配器列表失败", error);
        }
    };

    const fetchSystemInfo = async () => {
        try {
            const response = await authFetch(buildApiUrl("/api/system"), {
                cache: "no-store",
                signal: AbortSignal.timeout(5_000),
            });
            if (!response.ok) throw new Error(`系统信息请求失败（HTTP ${response.status}）`);
            const snapshot = parseSystemInfoSnapshot(
                response,
                await readManagementJsonResponse(response),
            );
            systemInfoIdentity.value = snapshot.identity;
            systemInfo.value = snapshot.info;
            systemInfoStatus.value = "ready";
            systemInfoError.value = "";
        } catch (error) {
            systemInfoStatus.value = "unavailable";
            systemInfoError.value = error instanceof Error ? error.message : "系统信息请求失败";
            reportClientError("获取系统信息失败", error);
        }
    };

    const fetchReadiness = async () => {
        readinessProbe.value = await probeReadiness();
    };

    const startLogsSSE = () => {
        logsEventSource?.close();
        logsEventSource = openAuthenticatedEventStream(buildApiUrl("/api/logs"), {
            onMessage(data) {
                const logData = JSON.parse(data);
                logs.value.push(logData.message);
                if (logs.value.length > 1000) logs.value = logs.value.slice(-1000);
            },
            onError: error => reportClientError("Logs SSE 连接错误", error),
        });
    };

    const startBot = async (platform: string, uin: string): Promise<BotLifecycleActionResult> => {
        const identity = adapterInventoryIdentity.value;
        if (!identity) {
            return { success: false, message: "账号运行态身份不可用，请刷新页面后重试" };
        }
        try {
            const response = await authFetch(
                buildApiUrl("/api/bots/start"),
                buildBotLifecycleActionRequestInit(platform, uin, identity),
            );
            const result = await parseBotLifecycleActionResponse(
                response,
                `启动机器人 ${uin} 失败`,
                identity,
                platform,
                uin,
            );
            if (result.success) {
                await fetchAdapters();
            }
            return result;
        } catch (error) {
            reportClientError("启动机器人失败", error);
            return { success: false, message: `启动机器人 ${uin} 失败：服务不可达` };
        }
    };

    const stopBot = async (platform: string, uin: string): Promise<BotLifecycleActionResult> => {
        const identity = adapterInventoryIdentity.value;
        if (!identity) {
            return { success: false, message: "账号运行态身份不可用，请刷新页面后重试" };
        }
        try {
            const response = await authFetch(
                buildApiUrl("/api/bots/stop"),
                buildBotLifecycleActionRequestInit(platform, uin, identity),
            );
            const result = await parseBotLifecycleActionResponse(
                response,
                `停止机器人 ${uin} 失败`,
                identity,
                platform,
                uin,
            );
            if (result.success) {
                await fetchAdapters();
            }
            return result;
        } catch (error) {
            reportClientError("停止机器人失败", error);
            return { success: false, message: `停止机器人 ${uin} 失败：服务不可达` };
        }
    };

    const RESOURCE_POLL_INTERVAL = 5_000;
    let resourcePollTimer: ReturnType<typeof setInterval> | null = null;

    const startResourcePolling = () => {
        stopResourcePolling();
        resourcePollTimer = setInterval(() => {
            if (enabled.adapters) void fetchAdapters();
            if (enabled.readiness) void fetchReadiness();
        }, RESOURCE_POLL_INTERVAL);
    };

    const stopResourcePolling = () => {
        if (resourcePollTimer) {
            clearInterval(resourcePollTimer);
            resourcePollTimer = null;
        }
    };

    const cleanup = () => {
        logsEventSource?.close();
        stopResourcePolling();
    };

    onMounted(() => {
        if (enabled.adapters) void fetchAdapters();
        if (enabled.systemInfo) void fetchSystemInfo();
        if (enabled.readiness) void fetchReadiness();
        if (enabled.adapters || enabled.readiness) startResourcePolling();
    });

    onUnmounted(() => {
        cleanup();
    });

    return {
        adapters,
        adapterInventoryIdentity,
        adapterInventoryStatus,
        adapterInventoryError,
        systemInfo,
        systemInfoIdentity,
        systemInfoStatus,
        systemInfoError,
        readinessProbe,
        logs,
        totalBotCount,
        fetchAdapters,
        fetchSystemInfo,
        fetchReadiness,
        startBot,
        stopBot,
        startLogsSSE,
        cleanup,
    };
}
