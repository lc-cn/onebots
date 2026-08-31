import { AdapterRegistry, type AdapterCapabilityManifest } from "@onebots/core";
import type { LoadedPluginInfo } from "./plugin-loader.js";

export type CapabilityCategory = "actions" | "events" | "segments" | "transports";

export interface CapabilityCategorySummary {
    total: number;
    supported: number;
    native: number;
    emulated: number;
    unsupported: number;
}

export interface AdapterCapabilityReportItem {
    name: string;
    displayName: string;
    description: string;
    packageName: string;
    packageVersion: string | null;
    entryPath: string;
    declared: boolean;
    summary: Record<CapabilityCategory, CapabilityCategorySummary> | null;
    capabilities: AdapterCapabilityManifest | null;
}

export interface AdapterCapabilityReport {
    complete: boolean;
    errors: string[];
    adapters: AdapterCapabilityReportItem[];
}

const CATEGORIES: CapabilityCategory[] = ["actions", "events", "segments", "transports"];

/** 从已完成加载契约校验的插件生成无连接能力报告。 */
export function buildAdapterCapabilityReport(
    loadedPlugins: readonly LoadedPluginInfo[],
    errors: readonly string[] = [],
): AdapterCapabilityReport {
    const adapters = loadedPlugins
        .filter(plugin => plugin.type === "adapter")
        .map(plugin => {
            const metadata = AdapterRegistry.getMetadata(plugin.name);
            const capabilities = metadata?.capabilities ?? null;
            return {
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
        })
        .sort((left, right) => left.name.localeCompare(right.name));
    return {
        complete: errors.length === 0 && adapters.every(adapter => adapter.declared),
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
    if (!report.adapters.length && !report.errors.length) {
        return "未选择适配器。请在 config.plugins.adapters 中配置，或通过 -r 指定。";
    }
    const labels: Record<CapabilityCategory, string> = {
        actions: "动作",
        events: "事件",
        segments: "消息段",
        transports: "连接方式",
    };
    const lines: string[] = [];
    for (const error of report.errors) lines.push(`✗ 加载失败: ${error}`);
    for (const adapter of report.adapters) {
        const title =
            adapter.displayName === adapter.name
                ? adapter.name
                : `${adapter.displayName} (${adapter.name})`;
        const version = adapter.packageVersion ? `@${adapter.packageVersion}` : "";
        lines.push(`${adapter.declared ? "✓" : "✗"} ${title} · ${adapter.packageName}${version}`);
        if (!adapter.summary) {
            lines.push("  未声明默认能力清单，无法在启动账号前验证平台边界");
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
    if (report.adapters.length) {
        lines.push(
            "默认清单来自插件注册元数据；账号权限与订阅造成的覆写请在服务启动后查询 /api/adapters。",
        );
    }
    return lines.join("\n");
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
