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
    parseBotLifecycleActionResponse,
    type BotLifecycleActionResult,
} from "../bot-lifecycle-action.js";

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
    const systemInfo = ref<SystemInfo | null>(null);
    const logs = ref<string[]>([]);
    const readinessProbe = ref<ServiceProbeResult>(pendingReadinessProbe());

    let logsEventSource: AuthenticatedEventStream | null = null;

    const totalBotCount = computed(() => {
        return adapters.value.reduce((acc, adapter) => acc + adapter.accounts.length, 0);
    });

    const fetchAdapters = async () => {
        try {
            const response = await authFetch(buildApiUrl("/api/adapters"));
            if (response.ok) {
                adapters.value = await response.json();
            }
        } catch (error) {
            reportClientError("获取适配器列表失败", error);
        }
    };

    const fetchSystemInfo = async () => {
        try {
            const response = await authFetch(buildApiUrl("/api/system"), {
                signal: AbortSignal.timeout(5_000),
            });
            if (response.ok) {
                systemInfo.value = await response.json();
            }
        } catch (error) {
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
        try {
            const response = await authFetch(buildApiUrl("/api/bots/start"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ platform, uin }),
            });
            const result = await parseBotLifecycleActionResponse(
                response,
                `启动机器人 ${uin} 失败`,
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
        try {
            const response = await authFetch(buildApiUrl("/api/bots/stop"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ platform, uin }),
            });
            const result = await parseBotLifecycleActionResponse(
                response,
                `停止机器人 ${uin} 失败`,
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
        systemInfo,
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
