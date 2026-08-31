import { ValidationError } from "@onebots/core";

export interface RuntimePluginSelection {
    adapters: string[];
    protocols: string[];
}

/** 读取配置中的插件默认选择；缺少 plugins 时保留旧版 CLI 行为。 */
export function getRuntimePluginSelection(
    config: Record<string, unknown>,
): RuntimePluginSelection | undefined {
    const value = config.plugins;
    if (value === undefined) return undefined;
    if (!isRecord(value)) throw new ValidationError("plugins 必须是对象");

    const unexpected = Object.keys(value).find(key => key !== "adapters" && key !== "protocols");
    if (unexpected) throw new ValidationError(`plugins 包含未知字段 ${unexpected}`);
    return {
        adapters: normalizePluginList(value.adapters, "plugins.adapters"),
        protocols: normalizePluginList(value.protocols, "plugins.protocols"),
    };
}

export function setRuntimePluginSelection(
    config: Record<string, unknown>,
    selection: RuntimePluginSelection,
): void {
    config.plugins = {
        adapters: normalizePluginList(selection.adapters, "plugins.adapters"),
        protocols: normalizePluginList(selection.protocols, "plugins.protocols"),
    };
}

function normalizePluginList(value: unknown, path: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new ValidationError(`${path} 必须是字符串数组`);
    const result: string[] = [];
    for (const [index, item] of value.entries()) {
        if (typeof item !== "string" || !item.trim()) {
            throw new ValidationError(`${path}.${index} 必须是非空字符串`);
        }
        const normalized = item.trim();
        if (!result.includes(normalized)) result.push(normalized);
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
