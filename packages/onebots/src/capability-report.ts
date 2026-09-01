import { AdapterRegistry, type AdapterCapabilityManifest } from "@onebots/core";
import { getExtensionCapabilityCatalogEntry } from "./extension-capability-catalog.js";
import { getExtensionCatalogEntry } from "./extension-catalog.js";
import type { LoadedPluginInfo } from "./plugin-loader.js";

export type CapabilityCategory = "actions" | "events" | "segments" | "transports";
export type CapabilityEvidenceStatus = "verified" | "unknown" | "unavailable";

export interface CapabilityCategorySummary {
    total: number;
    supported: number;
    native: number;
    emulated: number;
    unsupported: number;
}

export interface AdapterCapabilityReportItem {
    source: "catalog" | "runtime";
    status: CapabilityEvidenceStatus;
    name: string;
    displayName: string;
    description: string;
    packageName: string;
    packageVersion: string | null;
    entryPath: string | null;
    declared: boolean;
    summary: Record<CapabilityCategory, CapabilityCategorySummary> | null;
    capabilities: AdapterCapabilityManifest | null;
}

export interface AdapterCapabilityReport {
    complete: boolean;
    errors: string[];
    adapters: AdapterCapabilityReportItem[];
}

export type AdapterCapabilitySelectionSource = "cli" | "config" | "catalog";

/** 可归档的 CLI 能力证据，保留生成器身份与实际选择范围。 */
export interface AdapterCapabilityEvidenceReport extends AdapterCapabilityReport {
    schemaVersion: 1;
    generatedAt: string;
    application: {
        name: string;
        version: string;
    };
    target: {
        configPath: string;
        adapterSelection: {
            source: AdapterCapabilitySelectionSource;
            names: string[];
        };
    };
}

const CATEGORIES: CapabilityCategory[] = ["actions", "events", "segments", "transports"];

/** 从已完成加载契约校验的插件生成无连接能力报告。 */
export function buildAdapterCapabilityReport(
    loadedPlugins: readonly LoadedPluginInfo[],
    errors: readonly string[] = [],
    catalogPlatforms: readonly string[] = [],
    catalogAvailable = true,
): AdapterCapabilityReport {
    const runtimeAdapters = loadedPlugins
        .filter(plugin => plugin.type === "adapter")
        .map(plugin => {
            const metadata = AdapterRegistry.getMetadata(plugin.name);
            const capabilities = metadata?.capabilities ?? null;
            return {
                source: "runtime" as const,
                status: capabilities ? ("verified" as const) : ("unknown" as const),
                name: plugin.name,
                displayName: metadata?.displayName || plugin.name,
                description: metadata?.description || "",
                packageName: plugin.packageName,
                packageVersion: plugin.version,
                entryPath: plugin.entryPath,
                declared: capabilities !== null,
                summary: capabilities ? summarizeManifest(capabilities) : null,
                capabilities,
            } satisfies AdapterCapabilityReportItem;
        });
    const runtimeNames = new Set(runtimeAdapters.map(adapter => adapter.name));
    const catalogAdapters = [...new Set(catalogPlatforms)]
        .filter(platform => !runtimeNames.has(platform))
        .map(platform => {
            const capability = getExtensionCapabilityCatalogEntry(platform);
            const extension = getExtensionCatalogEntry(`adapter:${platform}`);
            const verified = catalogAvailable && capability !== undefined;
            return {
                source: "catalog" as const,
                status: verified ? ("verified" as const) : ("unavailable" as const),
                name: platform,
                displayName: extension?.displayName || platform,
                description: extension?.description || "",
                packageName: capability?.packageName || extension?.packageName || platform,
                packageVersion: verified ? capability.packageVersion : null,
                entryPath: null,
                declared: verified,
                summary: verified ? summarizeManifest(capability.manifest) : null,
                capabilities: verified ? capability.manifest : null,
            } satisfies AdapterCapabilityReportItem;
        });
    const adapters = [...runtimeAdapters, ...catalogAdapters].sort((left, right) =>
        left.name.localeCompare(right.name),
    );
    return {
        complete: errors.length === 0 && adapters.every(adapter => adapter.status === "verified"),
        errors: [...errors],
        adapters,
    };
}

/** JSON 用于 CI；文本输出保留支持级别和默认/账号边界。 */
export function formatAdapterCapabilityReport(
    report: AdapterCapabilityReport,
    json = false,
): string {
    if (json) return JSON.stringify(report, null, 2);
    const lines: string[] = [];
    if (isEvidenceReport(report)) lines.push(formatEvidenceScope(report));
    if (!report.adapters.length && !report.errors.length) {
        lines.push("未选择适配器。请在 config.plugins.adapters 中配置，或通过 -r 指定。");
        return lines.join("\n");
    }
    const labels: Record<CapabilityCategory, string> = {
        actions: "动作",
        events: "事件",
        segments: "消息段",
        transports: "连接方式",
    };
    for (const error of report.errors) lines.push(`✗ 加载失败: ${error}`);
    for (const adapter of report.adapters) {
        const title =
            adapter.displayName === adapter.name
                ? adapter.name
                : `${adapter.displayName} (${adapter.name})`;
        const version = adapter.packageVersion ? `@${adapter.packageVersion}` : "";
        const source = adapter.source === "catalog" ? "目录快照" : "运行时清单";
        lines.push(
            `${adapter.declared ? "✓" : "✗"} ${title} · ${adapter.packageName}${version} · ${source}`,
        );
        if (!adapter.summary) {
            lines.push(
                adapter.status === "unavailable"
                    ? "  能力目录证据不可用，不能据此判断平台是否支持这些能力"
                    : "  未声明默认能力清单，无法在启动账号前验证平台边界",
            );
            continue;
        }
        lines.push(
            "  " +
                CATEGORIES.map(category => {
                    const value = adapter.summary?.[category];
                    return `${labels[category]} ${value?.supported ?? 0}/${value?.total ?? 0}（原生 ${value?.native ?? 0}，模拟 ${value?.emulated ?? 0}，不支持 ${value?.unsupported ?? 0}）`;
                }).join("；"),
        );
    }
    if (report.adapters.some(adapter => adapter.source === "runtime")) {
        lines.push(
            "默认清单来自插件注册元数据；账号权限与订阅造成的覆写请在服务启动后查询 /api/adapters。",
        );
    }
    if (report.adapters.some(adapter => adapter.source === "catalog")) {
        lines.push("目录快照随当前 OneBots 版本发布，不代表适配器已安装或账号已授权。");
    }
    return lines.join("\n");
}

function isEvidenceReport(
    report: AdapterCapabilityReport,
): report is AdapterCapabilityEvidenceReport {
    return "schemaVersion" in report;
}

function formatEvidenceScope(report: AdapterCapabilityEvidenceReport): string {
    const selection = report.target.adapterSelection;
    const scope =
        selection.source === "catalog"
            ? `随包目录全部平台（${selection.names.length} 个）`
            : `${selection.source === "cli" ? "CLI 显式选择" : "配置选择"} [${selection.names.join(", ") || "无"}]`;
    return `能力证据: ${report.application.name}@${report.application.version} · ${scope} · 配置 ${report.target.configPath}`;
}

export function summarizeManifest(
    manifest: AdapterCapabilityManifest,
): Record<CapabilityCategory, CapabilityCategorySummary> {
    return Object.fromEntries(
        CATEGORIES.map(category => {
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
    ) as Record<CapabilityCategory, CapabilityCategorySummary>;
}
