import * as fs from "node:fs";
import type { ServiceSpec } from "./service-manager.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";
import {
    compareDoctorEndpointIdentities,
    probeDoctorEndpoint,
    resolveGatewayBaseUrl,
} from "./doctor-endpoint.js";

export interface ServiceOnlineVerificationOptions {
    fetcher?: typeof fetch;
    attempts?: number;
    intervalMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    previousInstanceId?: string | null;
}

/** 读取当前监听端口上的 OneBots 进程身份；不可达或旧端点返回 null。 */
export async function readServiceInstanceId(
    spec: ServiceSpec,
    fetcher: typeof fetch = fetch,
): Promise<string | null> {
    try {
        const config = parseRuntimeConfig(fs.readFileSync(spec.configPath, "utf8"));
        const response = await fetcher(`${resolveGatewayBaseUrl(config)}/health`, {
            cache: "no-store",
            signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) return null;
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || !("instance_id" in payload)) return null;
        const instanceId = payload.instance_id;
        return typeof instanceId === "string" && instanceId.trim() ? instanceId.trim() : null;
    } catch {
        // 操作前探测是尽力而为；不可达表示当前端口没有可比较的 OneBots 实例。
        return null;
    }
}

/** 等待服务以目标版本上线，并确认 readiness 至少允许继续首次配置。 */
export async function verifyServiceOnline(
    spec: ServiceSpec,
    expectedVersion: string,
    options: ServiceOnlineVerificationOptions = {},
): Promise<void> {
    const fetcher = options.fetcher ?? fetch;
    const attempts = options.attempts ?? 10;
    const intervalMs = options.intervalMs ?? 500;
    const sleep =
        options.sleep ??
        ((milliseconds: number) =>
            new Promise(resolve => {
                setTimeout(resolve, milliseconds);
            }));
    const config = parseRuntimeConfig(fs.readFileSync(spec.configPath, "utf8"));
    const base = resolveGatewayBaseUrl(config);
    let lastEvidence = "服务尚未响应";
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const checks = await Promise.all([
            probeDoctorEndpoint(base, "health", fetcher, expectedVersion),
            probeDoctorEndpoint(base, "ready", fetcher),
        ]);
        const identityCheck = compareDoctorEndpointIdentities(...checks);
        if (
            checks[0].level === "ok" &&
            checks[1].level !== "error" &&
            identityCheck.level === "ok"
        ) {
            const currentInstanceId = identityCheck.identity?.instanceId;
            if (!currentInstanceId) {
                lastEvidence = "成对探针检查未保留 instance_id，无法证明目标进程已接管端口";
            } else if (
                options.previousInstanceId &&
                currentInstanceId === options.previousInstanceId
            ) {
                lastEvidence = `实例仍为 ${currentInstanceId}，未证明新进程已接管端口`;
            } else {
                return;
            }
        } else {
            lastEvidence = [...checks, identityCheck].map(check => check.message).join("；");
        }
        if (attempt < attempts - 1) await sleep(intervalMs);
    }
    throw new Error(`目标版本 ${expectedVersion} 未在重试窗口内就绪（${lastEvidence}）`);
}
