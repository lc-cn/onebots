import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { runManagerMcp } from "../cli/manager-mcp.js";
export const description = "通过管理服务连接 MCP stdio，不启动账号或网关";
export const options = z.object({ dataDir: z.string().optional(), account: z.string().optional() });
function McpCommand({ options: input }: { options: z.infer<typeof options> }) {
    const args = Object.entries(input).flatMap(([key, value]) =>
        value === undefined ? [] : [key === "dataDir" ? "--data-dir" : "--account", value],
    );
    return (
        <CommandRunner
            execute={async () => {
                await runManagerMcp(args);
                return {};
            }}
        />
    );
}
McpCommand.useShell = false;
export default McpCommand;
