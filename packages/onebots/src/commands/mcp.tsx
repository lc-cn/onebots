import { CommandRunner } from "../cli/command-runner.js";
import { runMcpStdio } from "../cli/command-application.js";
import { runtimeOptions, type RuntimeOptions } from "../cli/command-options.js";
import { z } from "zod";
import { option } from "pastel";

export const description = "以 stdio 模式启动 MCP 服务（供 Cursor / Claude Code 等 Agent 使用）";

const mcpOptions = runtimeOptions.extend({
    account: z.string().optional().describe(option({
        alias: "a",
        description: "指定账号（格式: platform/account_id，如 qq/my-bot）",
        valueDescription: "account",
    })),
});

type McpOptions = z.infer<typeof mcpOptions>;

export const options = mcpOptions;

function McpCommand({ options: input }: { options: McpOptions }) {
    return <CommandRunner execute={() => runMcpStdio(input)} pending="正在启动 MCP stdio 服务…" />;
}
McpCommand.useShell = false;
export default McpCommand;
