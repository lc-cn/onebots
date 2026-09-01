import { isDeepStrictEqual } from "node:util";
import { assertAdapterCapabilities } from "@onebots/core";
import packageMetadata from "../package.json" with { type: "json" };
import { summarizeManifest } from "./capability-report.js";
import {
    getExtensionCapabilityCatalogEntry,
    getExtensionPackageCatalogEntry,
} from "./extension-capability-catalog.js";
import { EXTENSION_CATALOG } from "./extension-catalog.js";
import type { DoctorCheck } from "./doctor.js";
import type { ManagementFetch } from "./management-credential.js";
import { readDoctorManagementJson } from "./doctor-management-response.js";

interface CapabilityInventoryItem {
    source?: unknown;
    status?: unknown;
    name?: unknown;
    displayName?: unknown;
    description?: unknown;
    packageName?: unknown;
    packageVersion?: unknown;
    entryPath?: unknown;
    declared?: unknown;
    summary?: unknown;
    capabilities?: unknown;
}

/** 验证在线实例发布的完整、版本绑定适配器能力目录。 */
export async function probeAuthenticatedCapabilityCatalog(
    base: string,
    token: string,
    fetcher: ManagementFetch,
): Promise<DoctorCheck> {
    try {
        const response = await fetcher(`${base}/api/adapter-capabilities`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(2_000),
        });
        const payload = await readDoctorManagementJson(response);
        if (!response.ok) {
            return capabilityCatalogError(`在线能力目录响应无效: HTTP ${response.status}`);
        }
        return inspectCapabilityCatalogPayload(payload);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return capabilityCatalogError(`在线能力目录请求失败: ${message}`);
    }
}

export function inspectCapabilityCatalogPayload(payload: unknown): DoctorCheck {
    if (!isRecord(payload)) return capabilityCatalogError("响应必须是对象");

    const contractIssues: string[] = [];
    if (payload.schemaVersion !== 1) contractIssues.push("schemaVersion 必须为 1");
    if (typeof payload.generatedAt !== "string" || Number.isNaN(Date.parse(payload.generatedAt))) {
        contractIssues.push("generatedAt 必须是有效时间");
    }
    if (
        !isRecord(payload.application) ||
        payload.application.name !== packageMetadata.name ||
        payload.application.version !== packageMetadata.version
    ) {
        contractIssues.push(`应用身份必须为 ${packageMetadata.name}@${packageMetadata.version}`);
    }
    if (typeof payload.complete !== "boolean") contractIssues.push("complete 必须是布尔值");
    if (
        !Array.isArray(payload.errors) ||
        !payload.errors.every(error => typeof error === "string")
    ) {
        contractIssues.push("errors 必须是字符串数组");
    }
    if (!Array.isArray(payload.adapters)) contractIssues.push("adapters 必须是数组");
    if (contractIssues.length > 0) return invalidCapabilityCatalogContract(contractIssues);

    const errors = payload.errors as string[];
    const adapters = payload.adapters as CapabilityInventoryItem[];
    const expectedEntries = EXTENSION_CATALOG.filter(entry => entry.type === "adapter");
    const expectedByName = new Map(expectedEntries.map(entry => [entry.name, entry]));
    const names = new Set<string>();
    let runtimeCount = 0;

    for (const [index, adapter] of adapters.entries()) {
        const label =
            isRecord(adapter) && typeof adapter.name === "string" && adapter.name.trim()
                ? adapter.name.trim()
                : `#${index}`;
        if (!isRecord(adapter)) {
            contractIssues.push(`${label} 条目必须是对象`);
            continue;
        }
        if (typeof adapter.name !== "string" || !adapter.name.trim()) {
            contractIssues.push(`${label} 缺少 name`);
            continue;
        }
        const name = adapter.name.trim();
        if (names.has(name)) contractIssues.push(`${name} 重复出现`);
        names.add(name);
        if (adapter.source !== "catalog" && adapter.source !== "runtime") {
            contractIssues.push(`${name} 的 source 无效`);
        }
        if (!isEvidenceStatus(adapter.status)) contractIssues.push(`${name} 的 status 无效`);
        if (typeof adapter.displayName !== "string")
            contractIssues.push(`${name} 缺少 displayName`);
        if (typeof adapter.description !== "string")
            contractIssues.push(`${name} 缺少 description`);
        if (typeof adapter.packageName !== "string" || !adapter.packageName.trim()) {
            contractIssues.push(`${name} 缺少 packageName`);
        }
        if (
            adapter.packageVersion !== null &&
            (typeof adapter.packageVersion !== "string" || !adapter.packageVersion.trim())
        ) {
            contractIssues.push(`${name} 的 packageVersion 无效`);
        }
        if (adapter.entryPath !== null && typeof adapter.entryPath !== "string") {
            contractIssues.push(`${name} 的 entryPath 无效`);
        }
        if (typeof adapter.declared !== "boolean") contractIssues.push(`${name} 缺少 declared`);

        const hasManifest = adapter.capabilities !== null;
        if (adapter.declared !== hasManifest) {
            contractIssues.push(`${name} 的 declared 与 capabilities 矛盾`);
        }
        if (hasManifest) {
            try {
                assertAdapterCapabilities(adapter.capabilities);
                if (!isDeepStrictEqual(adapter.summary, summarizeManifest(adapter.capabilities))) {
                    contractIssues.push(`${name} 的 summary 与能力清单不一致`);
                }
            } catch (error) {
                contractIssues.push(
                    `${name} 的能力清单无效: ${boundedMessage(error instanceof Error ? error.message : String(error))}`,
                );
            }
        } else if (adapter.summary !== null) {
            contractIssues.push(`${name} 没有能力清单却声明了 summary`);
        }

        if (adapter.status === "verified" && (!hasManifest || adapter.packageVersion === null)) {
            contractIssues.push(`${name} 缺少版本绑定的已验证能力清单`);
        }
        if (adapter.source === "catalog") {
            if (adapter.entryPath !== null)
                contractIssues.push(`${name} 的目录快照不能包含入口路径`);
            const expected = expectedByName.get(name);
            if (!expected) {
                contractIssues.push(`${name} 不是当前版本的官方适配器却标记为目录快照`);
                continue;
            }
            if (adapter.packageName !== expected.packageName) {
                contractIssues.push(`${name} 的目录包名应为 ${expected.packageName}`);
            }
            const packageEntry = getExtensionPackageCatalogEntry(expected.packageName);
            const capabilityEntry = getExtensionCapabilityCatalogEntry(name);
            if (
                adapter.status === "verified" &&
                packageEntry &&
                capabilityEntry &&
                (adapter.packageVersion !== packageEntry.packageVersion ||
                    adapter.packageVersion !== capabilityEntry.packageVersion)
            ) {
                contractIssues.push(`${name} 的目录快照版本与当前版本固定目录不一致`);
            }
        } else if (adapter.source === "runtime") {
            runtimeCount++;
            if (typeof adapter.entryPath !== "string" || !adapter.entryPath.trim()) {
                contractIssues.push(`${name} 的运行时清单缺少入口路径`);
            }
            const expected = expectedByName.get(name);
            if (expected && adapter.packageName !== expected.packageName) {
                contractIssues.push(`${name} 的运行时包名应为 ${expected.packageName}`);
            }
        }
    }

    for (const expected of expectedEntries) {
        if (!names.has(expected.name)) contractIssues.push(`缺少官方适配器 ${expected.name}`);
    }
    const evidenceComplete =
        errors.length === 0 && adapters.every(adapter => adapter.status === "verified");
    if (payload.complete !== evidenceComplete) {
        contractIssues.push("complete 与条目状态或 errors 不一致");
    }
    if (contractIssues.length > 0) return invalidCapabilityCatalogContract(contractIssues);

    if (!payload.complete) {
        const unavailable = adapters
            .filter(adapter => adapter.status !== "verified")
            .map(adapter => `${String(adapter.name)}=${String(adapter.status)}`);
        const reasons = [...errors, ...unavailable].map(boundedMessage);
        return capabilityCatalogError(`证据不完整: ${reasons.join("；") || "未提供原因"}`);
    }

    return {
        name: "management-capability-catalog",
        level: "ok",
        message: `全平台能力目录已验证: ${expectedEntries.length} 个官方适配器，${runtimeCount} 个运行时清单，身份 ${packageMetadata.name}@${packageMetadata.version}`,
    };
}

function invalidCapabilityCatalogContract(issues: string[]): DoctorCheck {
    return capabilityCatalogError(
        `响应契约无效: ${issues.slice(0, 20).map(boundedMessage).join("；")}`,
    );
}

function capabilityCatalogError(message: string): DoctorCheck {
    return { name: "management-capability-catalog", level: "error", message };
}

function boundedMessage(message: string): string {
    return message.replaceAll(/\s+/g, " ").trim().slice(0, 500);
}

function isEvidenceStatus(value: unknown): value is "verified" | "unknown" | "unavailable" {
    return value === "verified" || value === "unknown" || value === "unavailable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
