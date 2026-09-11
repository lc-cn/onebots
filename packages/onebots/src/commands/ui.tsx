import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { runControlTuiCommand } from "../control/tui-command.js";

export const description = "连接管理服务工作台（不会启动旧网关）";
export const options = z.object({
    dataDir: z
        .string()
        .optional()
        .describe(option({ description: "管理服务工作区目录" })),
    setup: z.boolean().describe(option({ description: "进入依赖安装向导" })),
    configure: z.boolean().describe(option({ description: "进入配置草稿向导" })),
});
function UiCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={async () => {
                await runControlTuiCommand([
                    ...(input.dataDir ? ["--data-dir", input.dataDir] : []),
                    ...(input.setup ? ["--setup"] : []),
                    ...(input.configure ? ["--configure"] : []),
                ]);
                return {};
            }}
        />
    );
}
UiCommand.useShell = false;
export default UiCommand;
