import { ref, onMounted, onUnmounted, computed } from "vue";
import type { AdapterInfo, SystemInfo } from "../types";
import { buildApiUrl } from "../config";
import { authFetch, appendAuthQuery } from "./useAuth";
import { reportClientError } from "../client-diagnostics";
import {
    pendingReadinessProbe,
    probeReadiness,
    type ServiceProbeResult,
} from "../utils/service-probes.js";

export function useApi() {
    const adapters = ref<AdapterInfo[]>([]);
    const systemInfo = ref<SystemInfo | null>(null);
    const logs = ref<string[]>([]);
    const readinessProbe = ref<ServiceProbeResult>(pendingReadinessProbe());

    let logsEventSource: EventSource | null = null;

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
            const response = await authFetch(buildApiUrl("/api/system"));
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
        logsEventSource = new EventSource(appendAuthQuery(buildApiUrl("/api/logs")));

        logsEventSource.onmessage = e => {
            const logData = JSON.parse(e.data);
            logs.value.push(logData.message);
            if (logs.value.length > 1000) {
                logs.value = logs.value.slice(-1000);
            }
        };

        logsEventSource.onerror = () => {
            reportClientError("Logs SSE 连接错误");
            logsEventSource?.close();
            setTimeout(startLogsSSE, 5000);
        };
    };

    const startBot = async (platform: string, uin: string): Promise<boolean> => {
        try {
            const response = await authFetch(buildApiUrl("/api/bots/start"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ platform, uin }),
            });
            if (response.ok) {
                await fetchAdapters();
                return true;
            }
            return false;
        } catch (error) {
            reportClientError("启动机器人失败", error);
            return false;
        }
    };

    const stopBot = async (platform: string, uin: string): Promise<boolean> => {
        try {
            const response = await authFetch(buildApiUrl("/api/bots/stop"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ platform, uin }),
            });
            if (response.ok) {
                await fetchAdapters();
                return true;
            }
            return false;
        } catch (error) {
            reportClientError("停止机器人失败", error);
            return false;
        }
    };

    const ADAPTER_POLL_INTERVAL = 5_000;
    let adapterPollTimer: ReturnType<typeof setInterval> | null = null;

    const startAdapterPolling = () => {
        stopAdapterPolling();
        adapterPollTimer = setInterval(() => {
            void fetchAdapters();
            void fetchReadiness();
        }, ADAPTER_POLL_INTERVAL);
    };

    const stopAdapterPolling = () => {
        if (adapterPollTimer) {
            clearInterval(adapterPollTimer);
            adapterPollTimer = null;
        }
    };

    const cleanup = () => {
        logsEventSource?.close();
        stopAdapterPolling();
    };

    onMounted(() => {
        void fetchAdapters();
        void fetchSystemInfo();
        void fetchReadiness();
        startAdapterPolling();
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
