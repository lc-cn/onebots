import { ValidationError } from "@onebots/core";

export interface RuntimePluginSelection {
    adapters: string[];
    protocols: string[];
    applications?: string[];
}

/** 读取配置中的插件默认选择；缺少 plugins 时保留旧版 CLI 行为。 */
export function getRuntimePluginSelection(
    config: Record<string, unknown>,
): RuntimePluginSelection | undefined {
    const value = config.plugins;
    if (value === undefined) return undefined;
    if (!isRecord(value)) throw new ValidationError("plugins 必须是对象");

    const unexpected = Object.keys(value).find(
        key => key !== "adapters" && key !== "protocols" && key !== "applications",
    );
    if (unexpected) throw new ValidationError(`plugins 包含未知字段 ${unexpected}`);
    return {
        adapters: normalizePluginList(value.adapters, "plugins.adapters"),
        protocols: normalizePluginList(value.protocols, "plugins.protocols"),
        ...(value.applications === undefined
            ? {}
            : {
                  applications: normalizePluginList(value.applications, "plugins.applications"),
              }),
    };
}

export function setRuntimePluginSelection(
    config: Record<string, unknown>,
    selection: RuntimePluginSelection,
): void {
    config.plugins = {
        adapters: normalizePluginList(selection.adapters, "plugins.adapters"),
        protocols: normalizePluginList(selection.protocols, "plugins.protocols"),
        ...(selection.applications === undefined
            ? {}
            : {
                  applications: normalizePluginList(selection.applications, "plugins.applications"),
              }),
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

/** 容器不再预注册固定清单；旧配置仅从自身实际引用推导依赖，不写回文件。 */
export function getConfiguredPluginSelection(
    config: Record<string, unknown>,
    container = process.env.ONEBOTS_CONTAINER === "1",
): RuntimePluginSelection | undefined {
    const configured = getRuntimePluginSelection(config);
    if (configured || !container) return configured;
    const adapters = new Set<string>();
    const protocols = new Set<string>();
    const collectProtocols = (value: unknown) => {
        if (!isRecord(value)) return;
        for (const key of Object.keys(value))
            if (/^[a-z][a-z0-9-]*\.v\d+$/.test(key)) protocols.add(key.replace(".", "-"));
    };
    collectProtocols(config.general);
    for (const [key, value] of Object.entries(config)) {
        const separator = key.indexOf(".");
        if (separator <= 0) continue;
        adapters.add(key.slice(0, separator));
        collectProtocols(value);
    }
    return { adapters: [...adapters], protocols: [...protocols], applications: [] };
}
