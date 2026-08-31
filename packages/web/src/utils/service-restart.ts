import { buildApiUrl } from "../config";

interface HealthProbeResult {
    instanceId: string | null;
    evidence: string;
}

export interface RestartWaitOptions {
    fetcher?: typeof fetch;
    attempts?: number;
    initialDelayMs?: number;
    intervalMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
}

async function probeHealthInstance(fetcher: typeof fetch): Promise<HealthProbeResult> {
    try {
        const response = await fetcher(buildApiUrl("/health") || "/health", {
            cache: "no-store",
        });
        if (!response.ok) return { instanceId: null, evidence: `health HTTP ${response.status}` };
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object") {
            return { instanceId: null, evidence: "health 响应不是对象" };
        }
        if (!("application" in payload) || payload.application !== "onebots") {
            return { instanceId: null, evidence: "health 未声明 onebots 应用身份" };
        }
        const instanceId = "instance_id" in payload ? payload.instance_id : null;
        if (typeof instanceId !== "string" || !instanceId.trim()) {
            return { instanceId: null, evidence: "health 未声明 instance_id" };
        }
        return { instanceId: instanceId.trim(), evidence: `实例 ${instanceId.trim()}` };
    } catch (error) {
        return {
            instanceId: null,
            evidence: `health 不可达：${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/** 重启前记录可信的当前实例；证据不足时拒绝发送无法验证结果的重启请求。 */
export async function readCurrentServiceInstanceId(fetcher: typeof fetch = fetch): Promise<string> {
    const probe = await probeHealthInstance(fetcher);
    if (!probe.instanceId) {
        throw new Error(`无法在重启前确认当前 OneBots 实例（${probe.evidence}），未发送重启请求`);
    }
    return probe.instanceId;
}

/** 等待管理端恢复，并证明响应来自不同的新 OneBots 进程。 */
export async function waitForServiceRestart(
    previousInstanceId: string,
    options: RestartWaitOptions = {},
): Promise<string> {
    if (!previousInstanceId.trim()) {
        throw new Error("无法验证服务重启：缺少重启前的实例身份");
    }
    const fetcher = options.fetcher ?? fetch;
    const attempts = options.attempts ?? 40;
    const initialDelayMs = options.initialDelayMs ?? 2_500;
    const intervalMs = options.intervalMs ?? 1_500;
    const sleep =
        options.sleep ??
        ((milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds)));
    if (initialDelayMs > 0) await sleep(initialDelayMs);
    let lastEvidence = "尚未探测";
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const probe = await probeHealthInstance(fetcher);
        if (probe.instanceId && probe.instanceId !== previousInstanceId) return probe.instanceId;
        lastEvidence = probe.instanceId ? `旧实例 ${probe.instanceId} 仍在响应` : probe.evidence;
        if (attempt < attempts - 1) await sleep(intervalMs);
    }
    throw new Error(`服务重启超时，未观察到新实例（最后证据：${lastEvidence}）`);
}
