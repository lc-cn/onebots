import { assertAdapterCapabilities, stableJsonStringify } from "@onebots/core";
import { summarizeManifest } from "./capability-report.js";
import {
    getExtensionCapabilityCatalogEntry,
    getExtensionPackageCatalogEntry,
} from "./extension-capability-catalog.js";
import { TRUSTED_EXTENSION_CATALOG } from "./trusted-extension-catalog.js";

const INSTALLATION_PHASES = ["installing_package", "preflighting", "restoring_package"] as const;

/** 验证 Web 安装决策依赖的完整扩展目录，而不信任响应中的派生结论。 */
export function validateManagementExtensionInventory(payload: unknown[]): string[] {
    const issues = new Set<string>();
    const expected = new Map(TRUSTED_EXTENSION_CATALOG.map(entry => [entry.id, entry]));
    const actualIds = new Set<string>();

    for (const value of payload) {
        if (!isRecord(value)) {
            issues.add("扩展条目必须是对象");
            continue;
        }
        const id = isSafeText(value.id, 256) ? value.id : "unknown";
        if (id === "unknown") {
            issues.add("扩展条目缺少有效 id");
            continue;
        }
        if (actualIds.has(id)) issues.add(`扩展 id 重复: ${id}`);
        actualIds.add(id);
        const catalog = expected.get(id);
        if (!catalog) {
            issues.add(`扩展目录包含未知项: ${id}`);
            continue;
        }

        validateStaticIdentity(value, catalog, issues);
        validateRuntimeFields(value, id, issues);
        validateInstallationEvidence(value, id, issues);
        validateCapabilityEvidence(value, catalog.type, catalog.name, id, issues);
    }

    for (const id of expected.keys()) {
        if (!actualIds.has(id)) issues.add(`扩展目录缺少官方项: ${id}`);
    }
    return [...issues];
}

function validateStaticIdentity(
    value: Record<string, unknown>,
    catalog: (typeof TRUSTED_EXTENSION_CATALOG)[number],
    issues: Set<string>,
): void {
    const id = catalog.id;
    const expectedIdentity = {
        type: catalog.type,
        name: catalog.name,
        displayName: catalog.displayName,
        description: catalog.description,
        packageName: catalog.packageName,
        configurationTarget: catalog.configurationTarget,
        setup: catalog.setup,
    };
    const actualIdentity = {
        type: value.type,
        name: value.name,
        displayName: value.displayName,
        description: value.description,
        packageName: value.packageName,
        configurationTarget: value.configurationTarget,
        setup: value.setup,
    };
    if (!sameJson(actualIdentity, expectedIdentity)) {
        issues.add(`${id} 的目录身份、配置目标或引导步骤与当前 OneBots 不一致`);
    }
    const packageEntry = getExtensionPackageCatalogEntry(catalog.packageName);
    if (!packageEntry || value.targetVersion !== packageEntry.packageVersion) {
        issues.add(
            `${id} 的目标版本无效: 期望 ${packageEntry?.packageVersion ?? "目录缺失"}，实际 ${formatValue(value.targetVersion)}`,
        );
    }
}

function validateRuntimeFields(
    value: Record<string, unknown>,
    id: string,
    issues: Set<string>,
): void {
    for (const field of [
        "installed",
        "versionAligned",
        "enabled",
        "loaded",
        "installing",
    ] as const) {
        if (typeof value[field] !== "boolean") issues.add(`${id} 的 ${field} 必须是布尔值`);
    }
    if (typeof value.restartSupported !== "boolean") {
        issues.add(`${id} 的 restartSupported 必须是布尔值`);
    }
    for (const field of ["targetVersion", "installedVersion", "loadedVersion"] as const) {
        if (!isNullableText(value[field])) issues.add(`${id} 的 ${field} 必须是非空字符串或 null`);
    }
    for (const field of [
        "catalogError",
        "runtimeError",
        "packageManagerError",
        "runtimeConfigError",
        "installedError",
        "configurationError",
    ] as const) {
        if (!isNullableText(value[field])) issues.add(`${id} 的 ${field} 必须是非空诊断或 null`);
    }
}

function validateInstallationEvidence(
    value: Record<string, unknown>,
    id: string,
    issues: Set<string>,
): void {
    const installation = value.installation;
    const last = value.lastInstallation;
    const installing = value.installing === true;
    if (installing !== (installation !== null)) {
        issues.add(`${id} 的 installing 与活动安装证据矛盾`);
    }
    if (installation !== null && !isActiveInstallation(installation)) {
        issues.add(`${id} 的活动安装证据无效`);
    }
    if (last !== null && !isLastInstallation(last)) {
        issues.add(`${id} 的安装终态证据无效`);
    }
    if (installation !== null && last !== null) {
        issues.add(`${id} 同时携带活动安装与历史终态`);
    }
}

function validateCapabilityEvidence(
    value: Record<string, unknown>,
    type: "adapter" | "protocol",
    name: string,
    id: string,
    issues: Set<string>,
): void {
    const capability = value.capability;
    if (type === "protocol") {
        if (capability !== null) issues.add(`${id} 协议扩展不得携带适配器能力证据`);
        return;
    }
    if (!isRecord(capability)) {
        issues.add(`${id} 缺少适配器能力证据`);
        return;
    }
    const source = capability.source;
    const status = capability.status;
    if (
        (source !== "catalog" && source !== "runtime") ||
        !["verified", "unknown", "unavailable"].includes(String(status)) ||
        typeof capability.declared !== "boolean" ||
        !isNullableText(capability.packageVersion)
    ) {
        issues.add(`${id} 的能力证据结构无效`);
        return;
    }
    if (source !== (value.loaded === true ? "runtime" : "catalog")) {
        issues.add(`${id} 的能力来源与 loaded 状态矛盾`);
    }
    const hasManifest = capability.manifest !== null;
    const hasSummary = capability.summary !== null;
    if (capability.declared !== hasManifest || hasManifest !== hasSummary) {
        issues.add(`${id} 的能力声明、清单与摘要矛盾`);
        return;
    }
    if (status === "verified" && (!hasManifest || capability.packageVersion === null)) {
        issues.add(`${id} 缺少版本绑定的已验证能力`);
    }
    if (status === "unavailable" && (hasManifest || capability.packageVersion !== null)) {
        issues.add(`${id} 不可用时仍携带能力快照`);
    }
    if (!hasManifest) return;

    try {
        assertAdapterCapabilities(capability.manifest);
    } catch {
        issues.add(`${id} 的能力清单结构无效`);
        return;
    }
    if (!sameJson(capability.summary, summarizeManifest(capability.manifest))) {
        issues.add(`${id} 的能力摘要与清单不一致`);
    }
    if (source === "catalog" && status === "verified") {
        const catalogCapability = getExtensionCapabilityCatalogEntry(name);
        if (
            !catalogCapability ||
            capability.packageVersion !== catalogCapability.packageVersion ||
            !sameJson(capability.manifest, catalogCapability.manifest)
        ) {
            issues.add(`${id} 的目录能力快照与当前 OneBots 不一致`);
        }
    }
}

function isActiveInstallation(value: unknown): boolean {
    return (
        isRecord(value) &&
        !Object.hasOwn(value, "token") &&
        isSafeText(value.operationId, 256) &&
        INSTALLATION_PHASES.includes(value.phase as (typeof INSTALLATION_PHASES)[number]) &&
        isIsoTimestamp(value.startedAt)
    );
}

function isLastInstallation(value: unknown): boolean {
    if (
        !isRecord(value) ||
        !isSafeText(value.operationId, 256) ||
        (value.status !== "succeeded" && value.status !== "failed") ||
        !isIsoTimestamp(value.startedAt) ||
        !isIsoTimestamp(value.completedAt) ||
        Date.parse(value.completedAt) < Date.parse(value.startedAt) ||
        !isNullableText(value.message)
    ) {
        return false;
    }
    return value.status !== "succeeded" || value.message === null;
}

function sameJson(left: unknown, right: unknown): boolean {
    try {
        return stableJsonStringify(left) === stableJsonStringify(right);
    } catch {
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeText(value: unknown, maxLength: number): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= maxLength &&
        !/[\u0000-\u001f\u007f]/u.test(value)
    );
}

function isNullableText(value: unknown): boolean {
    return value === null || isSafeText(value, 4_000);
}

function isIsoTimestamp(value: unknown): value is string {
    return (
        isSafeText(value, 64) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString() === value
    );
}

function formatValue(value: unknown): string {
    return typeof value === "string" ? value.slice(0, 100) : String(value);
}
