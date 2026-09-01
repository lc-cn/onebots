import type {
    AdapterCapabilityManifest,
    CapabilityAvailability,
    CapabilityDescriptor,
    CapabilityDirection,
    CapabilitySupport,
    CommonTypes,
    SegmentCapabilityDescriptor,
    TransportCapabilityDescriptor,
} from "@onebots/core";
import type { AdapterCapabilityReport, AdapterInfo, ExtensionCapabilityInfo } from "../types";

const EMPTY_CAPABILITY_MANIFEST: AdapterCapabilityManifest = {
    version: 1,
    actions: {},
    events: {},
    segments: {},
    transports: {},
};

export const CAPABILITY_CATEGORIES = [
    { key: "actions", label: "动作" },
    { key: "events", label: "事件" },
    { key: "segments", label: "消息段" },
    { key: "transports", label: "传输" },
] as const;

export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number]["key"];
export type CapabilityEntryDescriptor =
    | CapabilityDescriptor
    | SegmentCapabilityDescriptor
    | TransportCapabilityDescriptor;

export interface CapabilityEntry {
    name: string;
    descriptor: CapabilityEntryDescriptor;
}

export function parseAdapterCapabilityReport(value: unknown): AdapterCapabilityReport {
    if (!value || typeof value !== "object") throw new Error("适配器能力响应必须是对象");
    const report = value as Partial<AdapterCapabilityReport>;
    if (
        report.schemaVersion !== 1 ||
        typeof report.generatedAt !== "string" ||
        Number.isNaN(Date.parse(report.generatedAt)) ||
        !report.application ||
        typeof report.application.name !== "string" ||
        !report.application.name.trim() ||
        typeof report.application.version !== "string" ||
        !report.application.version.trim() ||
        typeof report.application.instanceId !== "string" ||
        !report.application.instanceId.trim() ||
        (report.application.runtimeContractId !== undefined &&
            (typeof report.application.runtimeContractId !== "string" ||
                !report.application.runtimeContractId.trim())) ||
        typeof report.complete !== "boolean" ||
        !Array.isArray(report.errors) ||
        !report.errors.every(error => typeof error === "string") ||
        !Array.isArray(report.adapters)
    ) {
        throw new Error("适配器能力响应结构无效");
    }
    for (const adapter of report.adapters) {
        if (
            !adapter ||
            typeof adapter !== "object" ||
            !["catalog", "runtime"].includes(adapter.source) ||
            !["verified", "unknown", "unavailable"].includes(adapter.status) ||
            typeof adapter.name !== "string" ||
            typeof adapter.displayName !== "string" ||
            typeof adapter.description !== "string" ||
            typeof adapter.packageName !== "string" ||
            (adapter.packageVersion !== null && typeof adapter.packageVersion !== "string") ||
            typeof adapter.declared !== "boolean" ||
            (adapter.capabilities !== null && typeof adapter.capabilities !== "object")
        ) {
            throw new Error("适配器能力条目结构无效");
        }
    }
    return report as AdapterCapabilityReport;
}

export function capabilitySupportLabel(support: CapabilitySupport): string {
    return { native: "原生", emulated: "模拟", unsupported: "不支持" }[support];
}

export function capabilityAvailabilityLabel(availability: CapabilityAvailability): string {
    return { always: "始终可用", permission: "需要权限", context: "依赖上下文" }[availability];
}

export function capabilityDirectionLabel(direction: CapabilityDirection): string {
    return { send: "发送", receive: "接收", both: "双向" }[direction];
}

export function capabilitySceneLabel(scene: CommonTypes.Scene): string {
    return {
        private: "私聊",
        group: "群聊",
        channel: "频道",
        direct: "直接会话",
    }[scene];
}

/** 解释扩展能力证据为何尚不能视为版本绑定的已验证事实。 */
export function extensionCapabilityNotice(
    capability: Pick<ExtensionCapabilityInfo, "declared" | "manifest" | "source" | "status">,
): string | null {
    if (capability.status === "unavailable") {
        return "能力目录校验失败，当前无法提供可信快照；请修复目录错误后重试。";
    }
    if (!capability.declared || !capability.manifest) {
        return capability.source === "runtime"
            ? "当前插件未声明默认能力清单，请将未声明能力视为未知。"
            : "能力目录暂未收录此适配器，请安装后查看插件运行时清单。";
    }
    if (capability.status === "verified") return null;
    if (capability.source === "runtime") {
        return "当前插件已声明默认能力清单，但插件版本未知；该清单无法绑定到可归档的软件包版本。";
    }
    return "能力目录暂未收录此适配器，请安装后查看插件运行时清单。";
}

/**
 * 合并独立能力 API 与账号运行态。运行时账号覆写保持权威，未加载平台来自目录证据。
 */
export function mergeCapabilityReportAdapters(
    runtimeAdapters: readonly AdapterInfo[],
    report: AdapterCapabilityReport,
): AdapterInfo[] {
    const runtimePlatforms = new Set(runtimeAdapters.map(adapter => adapter.platform));
    const reportByPlatform = new Map(report.adapters.map(adapter => [adapter.name, adapter]));
    const unavailableReason = report.errors.join("；");
    return [
        ...runtimeAdapters.map(adapter => {
            const evidence = reportByPlatform.get(adapter.platform);
            const evidenceStatus =
                evidence && evidence.status !== "verified" ? evidence.status : undefined;
            return {
                ...adapter,
                capabilityDeclared: adapter.capabilityDeclared ?? evidence?.declared ?? true,
                capabilitySource: "runtime" as const,
                capabilityStatus:
                    evidenceStatus ??
                    adapter.capabilityStatus ??
                    evidence?.status ??
                    (adapter.capabilityDeclared === false ? "unknown" : "verified"),
                capabilityPackageVersion:
                    adapter.capabilityPackageVersion ?? evidence?.packageVersion,
            };
        }),
        ...report.adapters.flatMap(evidence => {
            if (runtimePlatforms.has(evidence.name)) return [];
            return [
                {
                    platform: evidence.name,
                    displayName: evidence.displayName,
                    description: evidence.description,
                    icon: "",
                    capabilities: evidence.capabilities ?? EMPTY_CAPABILITY_MANIFEST,
                    capabilityDeclared: evidence.declared,
                    capabilitySource: evidence.source,
                    capabilityPackageVersion: evidence.packageVersion,
                    capabilityStatus: evidence.status,
                    capabilityUnavailableReason:
                        evidence.status === "unavailable"
                            ? unavailableReason || "能力目录未通过完整性校验"
                            : undefined,
                    accounts: [],
                } satisfies AdapterInfo,
            ];
        }),
    ];
}

export function getCapabilityEntries(
    manifest: AdapterCapabilityManifest,
    category: CapabilityCategory,
): CapabilityEntry[] {
    return Object.entries(manifest[category])
        .map(([name, descriptor]) => ({ name, descriptor }))
        .sort((left, right) => {
            const supportOrder = { native: 0, emulated: 1, unsupported: 2 } as const;
            return (
                supportOrder[left.descriptor.support] - supportOrder[right.descriptor.support] ||
                left.name.localeCompare(right.name)
            );
        });
}

export function countSupportedCapabilities(
    manifest: AdapterCapabilityManifest,
    category: CapabilityCategory,
): number {
    return getCapabilityEntries(manifest, category).filter(
        entry => entry.descriptor.support !== "unsupported",
    ).length;
}

export function resolveAccountCapabilities(
    adapter: Pick<AdapterInfo, "accountCapabilities" | "capabilities">,
    accountId?: string,
): AdapterCapabilityManifest {
    return (accountId && adapter.accountCapabilities?.[accountId]) || adapter.capabilities;
}

export function hasAccountCapabilityOverride(
    adapter: Pick<AdapterInfo, "accountCapabilities">,
    accountId?: string,
): boolean {
    return Boolean(accountId && adapter.accountCapabilities?.[accountId]);
}

export function resolveAccountCapabilityError(
    adapter: Pick<AdapterInfo, "accountCapabilityErrors">,
    accountId?: string,
) {
    return accountId ? adapter.accountCapabilityErrors?.[accountId] : undefined;
}
