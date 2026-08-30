import type { Adapter } from "onebots";
import type { McpTool } from "./types.js";

/** MCP 工具的声明与 Adapter 执行 seam。 */
export interface ToolEntry {
    description: string;
    inputSchema: McpTool["inputSchema"];
    handler: (adapter: Adapter, uin: string, args: Record<string, unknown>) => Promise<unknown>;
}
