import { buildApiUrl } from "../config";
import { readBoundedJsonResponse, ResponseBodyTooLargeError } from "../bounded-response.js";
import { readManagementJsonResponse } from "../management-response.js";
import {
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "../management-evidence-identity.js";
import {
    DEFAULT_SERVICE_PROBE_TIMEOUT_MS,
    runServiceProbe,
    ServiceProbeTimeoutError,
} from "./service-probe-request";
import { WEB_PUBLIC_PROBE_BODY_LIMIT_BYTES } from "./service-probes.js";

interface HealthProbeResult {
    identity: ManagementEvidenceIdentity | null;
    evidence: string;
}

export interface RestartWaitOptions {
    fetcher?: typeof fetch;
    attempts?: number;
    initialDelayMs?: number;
    intervalMs?: number;
    probeTimeoutMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
}

export interface RestartAcknowledgement {
    scheduled: boolean;
    message: string;
}

async function probeHealthInstance(
    fetcher: typeof fetch,
    timeoutMs: number,
): Promise<HealthProbeResult> {
    try {
        const { response, payload } = await runServiceProbe(async signal => {
            const response = await fetcher(buildApiUrl("/health") || "/health", {
                cache: "no-store",
                redirect: "error",
                signal,
            });
            const payload: unknown = response.ok
                ? await readBoundedJsonResponse(response, WEB_PUBLIC_PROBE_BODY_LIMIT_BYTES)
                : null;
            return { response, payload };
        }, timeoutMs);
        if (!response.ok) return { identity: null, evidence: `health HTTP ${response.status}` };
        if (!payload || typeof payload !== "object") {
            return { identity: null, evidence: "health 响应不是对象" };
        }
        if (!("application" in payload) || payload.application !== "onebots") {
            return { identity: null, evidence: "health 未声明 onebots 应用身份" };
        }
        const version = "version" in payload ? payload.version : null;
        if (typeof version !== "string" || !version.trim()) {
            return { identity: null, evidence: "health 未声明运行版本" };
        }
        const instanceId = "instance_id" in payload ? payload.instance_id : null;
        if (typeof instanceId !== "string" || !instanceId.trim()) {
            return { identity: null, evidence: "health 未声明 instance_id" };
        }
        const runtimeContractId =
            "runtime_contract_id" in payload && typeof payload.runtime_contract_id === "string"
                ? payload.runtime_contract_id.trim()
                : "";
        return {
            identity: {
                application: "onebots",
                version: version.trim(),
                instanceId: instanceId.trim(),
                ...(runtimeContractId ? { runtimeContractId } : {}),
            },
            evidence: `onebots@${version.trim()} 实例 ${instanceId.trim()}`,
        };
    } catch (error) {
        return {
            identity: null,
            evidence:
                error instanceof ServiceProbeTimeoutError
                    ? `health 探测超时（${error.timeoutMs}ms）`
                    : `health 不可达：${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/** 重启前记录可信的完整当前实例；证据不足时拒绝发送无法验证结果的重启请求。 */
export async function readCurrentServiceIdentity(
    fetcher: typeof fetch = fetch,
    timeoutMs = DEFAULT_SERVICE_PROBE_TIMEOUT_MS,
): Promise<ManagementEvidenceIdentity> {
    const probe = await probeHealthInstance(fetcher, timeoutMs);
    if (!probe.identity) {
        throw new Error(`无法在重启前确认当前 OneBots 实例（${probe.evidence}），未发送重启请求`);
    }
    return probe.identity;
}

/** 兼容只需要实例号的等待与展示调用。 */
export async function readCurrentServiceInstanceId(
    fetcher: typeof fetch = fetch,
    timeoutMs = DEFAULT_SERVICE_PROBE_TIMEOUT_MS,
): Promise<string> {
    return (await readCurrentServiceIdentity(fetcher, timeoutMs)).instanceId;
}

/** 请求已探测实例重启，并验证机器回执确实来自该 OneBots 进程。 */
export async function requestServiceRestart(
    expectedIdentity: ManagementEvidenceIdentity,
    fetcher: typeof fetch = fetch,
): Promise<RestartAcknowledgement> {
    if (!expectedIdentity.instanceId.trim()) {
        throw new Error("无法请求服务重启：缺少可信的当前实例身份");
    }
    const response = await fetcher(buildApiUrl("/api/system/restart"), {
        method: "POST",
        headers: {
            "content-type": "application/json",
            [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: expectedIdentity.instanceId.trim(),
        },
        body: JSON.stringify({ instance_id: expectedIdentity.instanceId.trim() }),
        cache: "no-store",
        redirect: "error",
    });
    const responseIdentity = parseManagementEvidenceIdentity(response);
    if (!sameManagementEvidenceIdentity(responseIdentity, expectedIdentity)) {
        throw new Error(
            `重启响应实例不匹配：期望 ${expectedIdentity.instanceId}，实际 ${responseIdentity.instanceId}`,
        );
    }
    let payload: unknown;
    try {
        payload = await readManagementJsonResponse(response);
    } catch (error) {
        if (error instanceof ResponseBodyTooLargeError) {
            throw new Error(`重启回执无效：${error.message}`);
        }
        throw new Error(
            response.ok
                ? "重启端点未返回有效 JSON 回执"
                : `重启请求失败（HTTP ${response.status}）`,
        );
    }
    if (!response.ok) {
        throw new Error(readRestartMessage(payload) || `重启请求失败（HTTP ${response.status}）`);
    }
    if (!payload || typeof payload !== "object") {
        throw new Error("重启端点未返回对象回执");
    }
    if (!("success" in payload) || payload.success !== true) {
        throw new Error(readRestartMessage(payload) || "重启端点未确认已接受请求");
    }
    if (!("application" in payload) || payload.application !== "onebots") {
        throw new Error("重启回执未声明 onebots 应用身份");
    }
    if (!("instance_id" in payload) || payload.instance_id !== expectedIdentity.instanceId.trim()) {
        throw new Error(
            `重启回执实例不匹配：期望 ${expectedIdentity.instanceId.trim()}，实际 ${
                "instance_id" in payload && typeof payload.instance_id === "string"
                    ? payload.instance_id
                    : "缺失"
            }`,
        );
    }
    if (!("scheduled" in payload) || typeof payload.scheduled !== "boolean") {
        throw new Error("重启回执未声明调度状态");
    }
    return {
        scheduled: payload.scheduled,
        message: readRestartMessage(payload) || "服务已接受重启请求",
    };
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
    const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_SERVICE_PROBE_TIMEOUT_MS;
    const sleep =
        options.sleep ??
        ((milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds)));
    if (initialDelayMs > 0) await sleep(initialDelayMs);
    let lastEvidence = "尚未探测";
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const probe = await probeHealthInstance(fetcher, probeTimeoutMs);
        if (probe.identity && probe.identity.instanceId !== previousInstanceId) {
            return probe.identity.instanceId;
        }
        lastEvidence = probe.identity
            ? `旧实例 ${probe.identity.instanceId} 仍在响应`
            : probe.evidence;
        if (attempt < attempts - 1) await sleep(intervalMs);
    }
    throw new Error(`服务重启超时，未观察到新实例（最后证据：${lastEvidence}）`);
}

function readRestartMessage(value: unknown): string {
    if (!value || typeof value !== "object" || !("message" in value)) return "";
    return typeof value.message === "string" ? value.message.trim() : "";
}
