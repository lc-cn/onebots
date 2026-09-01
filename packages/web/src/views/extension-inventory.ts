import type {
    CapabilityCategorySummary,
    ExtensionCapabilityInfo,
    ExtensionInfo,
    PackageMutationStatus,
} from "../types.js";
import { assertCapabilityManifest } from "../components/capability-presentation.js";
import {
    MANAGEMENT_CONFIG_REVISION_HEADER,
    MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER,
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "../management-evidence-identity.js";

const CAPABILITY_CATEGORIES = ["actions", "events", "segments", "transports"] as const;
const INSTALLATION_PHASES = ["installing_package", "preflighting", "restoring_package"] as const;

export interface ExtensionManagementSnapshot {
    identity: ManagementEvidenceIdentity;
    configRevision: string;
    extensions: ExtensionInfo[];
    packageMutationStatus: PackageMutationStatus;
}

/** 将安装请求绑定到生成扩展目录的实例和配置内容。 */
export function buildExtensionInstallRequestHeaders(
    identity: ManagementEvidenceIdentity,
    configRevision: string,
    operation = "安装",
): Record<string, string> {
    if (!/^sha256:[a-f0-9]{64}$/u.test(configRevision)) {
        throw new Error(`扩展${operation}请求缺少有效配置修订号`);
    }
    return {
        [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: identity.instanceId,
        [MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER]: configRevision,
    };
}

/** 原子采用扩展目录、配置修订和包变更租约，拒绝跨实例或无修订的可执行快照。 */
export function parseExtensionManagementSnapshot(
    inventoryResponse: Pick<Response, "headers">,
    mutationResponse: Pick<Response, "headers">,
    inventoryValue: unknown,
    mutationValue: unknown,
): ExtensionManagementSnapshot {
    const identity = parseManagementEvidenceIdentity(inventoryResponse);
    const mutationIdentity = parseManagementEvidenceIdentity(mutationResponse);
    if (!sameManagementEvidenceIdentity(identity, mutationIdentity)) {
        throw new Error("扩展目录与包变更状态来自不同 OneBots 实例");
    }
    const configRevision =
        inventoryResponse.headers.get(MANAGEMENT_CONFIG_REVISION_HEADER)?.trim() ?? "";
    if (!/^sha256:[a-f0-9]{64}$/u.test(configRevision)) {
        throw new Error("扩展目录缺少有效配置修订号，安装操作已禁用");
    }
    return {
        identity,
        configRevision,
        extensions: parseExtensionInventory(inventoryValue),
        packageMutationStatus: parsePackageMutationStatus(mutationValue),
    };
}

/** 安装完成必须由读取目录时的同一实例确认，并返回提交后的配置修订。 */
export function assertExtensionInstallAcknowledgement(
    response: Pick<Response, "headers">,
    value: unknown,
    expectedIdentity: ManagementEvidenceIdentity,
    operation = "安装",
): string {
    const identity = parseManagementEvidenceIdentity(response);
    if (!sameManagementEvidenceIdentity(identity, expectedIdentity)) {
        throw new Error(
            `扩展${operation}回执实例不匹配：期望 ${expectedIdentity.instanceId}，实际 ${identity.instanceId}`,
        );
    }
    if (
        !isRecord(value) ||
        value.success !== true ||
        value.application !== "onebots" ||
        value.instance_id !== expectedIdentity.instanceId
    ) {
        throw new Error(`扩展${operation}回执未由预期 OneBots 实例确认`);
    }
    const configRevision = value.config_revision;
    if (typeof configRevision !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(configRevision)) {
        throw new Error(`扩展${operation}回执缺少有效配置修订号`);
    }
    return configRevision;
}

/** 在扩展目录进入安装决策与机器人引导前校验完整响应及状态闭合。 */
export function parseExtensionInventory(value: unknown): ExtensionInfo[] {
    if (!Array.isArray(value)) throw new Error("功能扩展目录响应必须是数组");
    const ids = new Set<string>();
    return value.map((entry, index) => parseExtension(entry, index, ids));
}

/** 拒绝状态、自身可用性和租约所有者相互矛盾的包变更证据。 */
export function parsePackageMutationStatus(value: unknown): PackageMutationStatus {
    if (!isRecord(value)) throw new Error("包变更状态响应必须是对象");
    if (
        !isOneOf(value.state, ["idle", "active", "recoverable", "invalid"] as const) ||
        typeof value.available !== "boolean" ||
        !isNullableText(value.error)
    ) {
        throw new Error("包变更状态响应结构无效");
    }
    const owner = value.owner === null ? null : parsePackageMutationOwner(value.owner);
    if (
        (value.state === "idle" && (!value.available || owner !== null || value.error !== null)) ||
        (value.state === "active" && (value.available || owner === null || value.error !== null)) ||
        (value.state === "invalid" && (value.available || owner !== null || !value.error)) ||
        (value.state === "recoverable" &&
            (!value.available || (owner === null ? !value.error : value.error !== null)))
    ) {
        throw new Error("包变更状态结论与租约证据矛盾");
    }
    return value as unknown as PackageMutationStatus;
}

function parseExtension(value: unknown, index: number, ids: Set<string>): ExtensionInfo {
    if (!isRecord(value)) throw new Error(`功能扩展目录第 ${index + 1} 项必须是对象`);
    const type = value.type;
    if (
        !isOneOf(type, ["adapter", "protocol"] as const) ||
        !isText(value.name) ||
        !isText(value.id) ||
        value.id !== `${type}:${value.name}` ||
        !isText(value.displayName) ||
        typeof value.description !== "string" ||
        !isText(value.packageName) ||
        !Array.isArray(value.setup) ||
        !value.setup.every(isSetupStep) ||
        !isNullableText(value.configurationError) ||
        !isNullableText(value.catalogError) ||
        !isOptionalNullableText(value.runtimeError) ||
        !isOptionalNullableText(value.packageManagerError) ||
        !isOptionalNullableText(value.runtimeConfigError) ||
        !isOptionalNullableText(value.installedError) ||
        !isNullableText(value.targetVersion) ||
        !isNullableText(value.installedVersion) ||
        !isOptionalNullableText(value.loadedVersion) ||
        typeof value.versionAligned !== "boolean" ||
        typeof value.installed !== "boolean" ||
        typeof value.enabled !== "boolean" ||
        typeof value.loaded !== "boolean" ||
        typeof value.installing !== "boolean" ||
        (value.restartSupported !== undefined && typeof value.restartSupported !== "boolean")
    ) {
        throw new Error(`功能扩展目录第 ${index + 1} 项结构无效`);
    }
    if (ids.has(value.id)) throw new Error(`功能扩展目录包含重复 id: ${value.id}`);
    ids.add(value.id);
    assertConfigurationTarget(type, value.name, value.configurationTarget);

    if (value.installed !== (value.installedVersion !== null)) {
        throw new Error(`扩展 ${value.id} 的 installed 与 installedVersion 矛盾`);
    }
    if (!value.loaded && value.loadedVersion != null) {
        throw new Error(`扩展 ${value.id} 未加载却声明 loadedVersion`);
    }
    if (
        value.versionAligned &&
        (!value.installed ||
            value.targetVersion === null ||
            value.installedVersion !== value.targetVersion)
    ) {
        throw new Error(`扩展 ${value.id} 的版本对齐结论无效`);
    }

    const installation = parseInstallation(value.installation, value.id);
    if (!value.installing && installation !== null) {
        throw new Error(`扩展 ${value.id} 未安装中却携带活动操作`);
    }
    const lastInstallation = parseLastInstallation(value.lastInstallation, value.id);
    if (installation && lastInstallation) {
        throw new Error(`扩展 ${value.id} 同时携带活动操作与终态`);
    }
    if (value.disabling !== undefined && typeof value.disabling !== "boolean") {
        throw new Error(`扩展 ${value.id} 的停用状态无效`);
    }
    const disableOperation = parseDisableOperation(value.disableOperation, value.id);
    const disabling = value.disabling ?? disableOperation !== null;
    if (!disabling && disableOperation !== null) {
        throw new Error(`扩展 ${value.id} 未停用中却携带活动停用操作`);
    }
    const lastDisable = parseLastDisable(value.lastDisable, value.id);
    if (disableOperation && lastDisable) {
        throw new Error(`扩展 ${value.id} 同时携带活动停用与停用终态`);
    }
    if (installation && disableOperation) {
        throw new Error(`扩展 ${value.id} 同时安装和停用`);
    }
    const capability = parseExtensionCapability(value.capability, value.id);
    if (type === "protocol" && capability !== null) {
        throw new Error(`协议扩展 ${value.id} 不得携带适配器能力清单`);
    }
    if (type === "adapter" && capability === null) {
        throw new Error(`适配器扩展 ${value.id} 缺少能力证据`);
    }
    if (capability && capability.source !== (value.loaded ? "runtime" : "catalog")) {
        throw new Error(`扩展 ${value.id} 的能力来源与加载状态矛盾`);
    }
    return value as unknown as ExtensionInfo;
}

function parseDisableOperation(value: unknown, id: string): ExtensionInfo["disableOperation"] {
    if (value === undefined || value === null) return null;
    if (!isRecord(value) || !isText(value.operationId) || !isIsoTimestamp(value.startedAt)) {
        throw new Error(`扩展 ${id} 的活动停用证据无效`);
    }
    return value as NonNullable<ExtensionInfo["disableOperation"]>;
}

function parseLastDisable(value: unknown, id: string): ExtensionInfo["lastDisable"] {
    if (value === undefined || value === null) return null;
    if (
        !isRecord(value) ||
        !isText(value.operationId) ||
        !isOneOf(value.status, ["succeeded", "failed"] as const) ||
        !isIsoTimestamp(value.startedAt) ||
        !isIsoTimestamp(value.completedAt) ||
        Date.parse(value.completedAt) < Date.parse(value.startedAt) ||
        !isNullableText(value.message) ||
        (value.status === "succeeded" && value.message !== null)
    ) {
        throw new Error(`扩展 ${id} 的停用终态证据无效`);
    }
    return value as NonNullable<ExtensionInfo["lastDisable"]>;
}

function assertConfigurationTarget(
    type: "adapter" | "protocol",
    name: string,
    value: unknown,
): void {
    if (!isRecord(value)) throw new Error(`扩展 ${type}:${name} 的配置目标无效`);
    if (type === "adapter") {
        if (value.kind !== "account" || value.platform !== name) {
            throw new Error(`适配器扩展 ${type}:${name} 的账号配置目标无效`);
        }
        return;
    }
    if (value.kind !== "protocol" || !isText(value.protocolKey)) {
        throw new Error(`协议扩展 ${type}:${name} 的协议配置目标无效`);
    }
}

function parseInstallation(value: unknown, id: string): ExtensionInfo["installation"] {
    if (value === undefined || value === null) return null;
    if (
        !isRecord(value) ||
        !isText(value.operationId) ||
        !isOneOf(value.phase, INSTALLATION_PHASES) ||
        !isIsoTimestamp(value.startedAt)
    ) {
        throw new Error(`扩展 ${id} 的活动安装证据无效`);
    }
    return value as unknown as NonNullable<ExtensionInfo["installation"]>;
}

function parseLastInstallation(value: unknown, id: string): ExtensionInfo["lastInstallation"] {
    if (value === undefined || value === null) return null;
    if (
        !isRecord(value) ||
        !isText(value.operationId) ||
        !isOneOf(value.status, ["succeeded", "failed"] as const) ||
        !isIsoTimestamp(value.startedAt) ||
        !isIsoTimestamp(value.completedAt) ||
        Date.parse(value.completedAt) < Date.parse(value.startedAt) ||
        !isNullableText(value.message) ||
        (value.status === "succeeded" && value.message !== null)
    ) {
        throw new Error(`扩展 ${id} 的安装终态证据无效`);
    }
    return value as unknown as NonNullable<ExtensionInfo["lastInstallation"]>;
}

function parseExtensionCapability(value: unknown, id: string): ExtensionCapabilityInfo | null {
    if (value === null) return null;
    if (
        !isRecord(value) ||
        !isOneOf(value.source, ["catalog", "runtime"] as const) ||
        !isOneOf(value.status, ["verified", "unknown", "unavailable"] as const) ||
        !isNullableText(value.packageVersion) ||
        typeof value.declared !== "boolean"
    ) {
        throw new Error(`扩展 ${id} 的能力证据结构无效`);
    }
    const hasManifest = value.manifest !== null;
    const hasSummary = value.summary !== null;
    if (value.declared !== hasManifest || hasManifest !== hasSummary) {
        throw new Error(`扩展 ${id} 的能力声明、清单与摘要矛盾`);
    }
    if (value.status === "verified" && (!hasManifest || value.packageVersion === null)) {
        throw new Error(`扩展 ${id} 缺少版本绑定的已验证能力`);
    }
    if (value.status === "unavailable" && (hasManifest || value.packageVersion !== null)) {
        throw new Error(`扩展 ${id} 不可用时不得携带能力快照`);
    }
    if (hasManifest) {
        try {
            assertCapabilityManifest(value.manifest);
        } catch {
            throw new Error(`扩展 ${id} 的能力清单结构无效`);
        }
        const expected = summarizeCapabilityManifest(value.manifest);
        if (!capabilitySummaryMatches(value.summary, expected)) {
            throw new Error(`扩展 ${id} 的能力摘要与清单不一致`);
        }
    }
    return value as unknown as ExtensionCapabilityInfo;
}

function summarizeCapabilityManifest(
    manifest: NonNullable<ExtensionCapabilityInfo["manifest"]>,
): Record<(typeof CAPABILITY_CATEGORIES)[number], CapabilityCategorySummary> {
    return Object.fromEntries(
        CAPABILITY_CATEGORIES.map(category => {
            const descriptors = Object.values(manifest[category]);
            const native = descriptors.filter(item => item.support === "native").length;
            const emulated = descriptors.filter(item => item.support === "emulated").length;
            const unsupported = descriptors.filter(item => item.support === "unsupported").length;
            return [
                category,
                {
                    total: descriptors.length,
                    supported: native + emulated,
                    native,
                    emulated,
                    unsupported,
                },
            ];
        }),
    ) as Record<(typeof CAPABILITY_CATEGORIES)[number], CapabilityCategorySummary>;
}

function capabilitySummaryMatches(
    value: unknown,
    expected: Record<(typeof CAPABILITY_CATEGORIES)[number], CapabilityCategorySummary>,
): boolean {
    return (
        isRecord(value) &&
        CAPABILITY_CATEGORIES.every(category => {
            const summary = value[category];
            return (
                isRecord(summary) &&
                (["total", "supported", "native", "emulated", "unsupported"] as const).every(
                    field =>
                        isNonNegativeInteger(summary[field]) &&
                        summary[field] === expected[category][field],
                )
            );
        })
    );
}

function parsePackageMutationOwner(value: unknown): PackageMutationStatus["owner"] {
    if (
        !isRecord(value) ||
        Object.hasOwn(value, "token") ||
        !isText(value.operationId) ||
        !isOneOf(value.operation, [
            "extension_install",
            "extension_disable",
            "package_update",
        ] as const) ||
        !isText(value.host) ||
        !Number.isSafeInteger(value.pid) ||
        Number(value.pid) <= 0 ||
        !isIsoTimestamp(value.startedAt) ||
        (value.operation === "extension_install" || value.operation === "extension_disable"
            ? !isText(value.extensionId)
            : value.extensionId !== null)
    ) {
        throw new Error("包变更租约所有者结构无效");
    }
    return value as unknown as NonNullable<PackageMutationStatus["owner"]>;
}

function isSetupStep(value: unknown): boolean {
    if (!isRecord(value) || !isText(value.title) || !isText(value.description)) return false;
    if (value.url === undefined) return true;
    if (!isText(value.url)) return false;
    try {
        return new URL(value.url).protocol === "https:";
    } catch {
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim());
}

function isNullableText(value: unknown): value is string | null {
    return value === null || isText(value);
}

function isOptionalNullableText(value: unknown): boolean {
    return value === undefined || isNullableText(value);
}

function isIsoTimestamp(value: unknown): value is string {
    return (
        isText(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString() === value
    );
}

function isNonNegativeInteger(value: unknown): boolean {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
    return typeof value === "string" && values.includes(value as T);
}
