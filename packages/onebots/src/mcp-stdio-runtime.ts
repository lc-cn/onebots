import type { Protocol } from "@onebots/core";
import { getLoadedPlugins, type LoadedPluginInfo } from "./plugin-loader.js";

export interface McpStdioTransportOptions {
    protocol: Protocol;
    onClose?: () => void | Promise<void>;
}

export type McpStdioTransportStarter = (options: McpStdioTransportOptions) => void;

type ModuleImporter = (specifier: string) => Promise<unknown>;

/** 从已通过插件注册契约验证的同一入口取得 MCP stdio 导出，避免再次按宿主包位置解析。 */
export async function loadMcpStdioTransport(
    plugins: readonly LoadedPluginInfo[] = getLoadedPlugins(),
    importer: ModuleImporter = specifier => import(specifier),
): Promise<McpStdioTransportStarter> {
    const plugin = plugins.find(
        item => item.type === "protocol" && item.packageName === "@onebots/protocol-mcp-v1",
    );
    if (!plugin) {
        throw new Error("当前进程没有已验证的 @onebots/protocol-mcp-v1 插件入口");
    }

    if (!plugin.moduleUrl) {
        throw new Error(
            `${plugin.packageName}@${plugin.version ?? "未知版本"} 缺少当前进程实际加载的模块身份；请重启 OneBots 后重试`,
        );
    }
    const module = await importer(plugin.moduleUrl);
    if (!isMcpStdioModule(module)) {
        throw new Error(
            `${plugin.packageName}@${plugin.version ?? "未知版本"} 未导出 startStdioTransport；请在扩展中心修复为当前 OneBots 验证版本`,
        );
    }
    return module.startStdioTransport;
}

function isMcpStdioModule(value: unknown): value is {
    startStdioTransport: McpStdioTransportStarter;
} {
    return (
        typeof value === "object" &&
        value !== null &&
        "startStdioTransport" in value &&
        typeof value.startStdioTransport === "function"
    );
}
