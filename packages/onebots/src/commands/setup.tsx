import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { runControlTuiCommand } from "../control/tui-command.js";
import { options } from "./ui.js";

export { options };
export const description = "连接管理服务并进入依赖安装向导";
function SetupCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={async () => {
                await runControlTuiCommand([
                    "--setup",
                    ...(input.dataDir ? ["--data-dir", input.dataDir] : []),
                    ...(input.configure ? ["--configure"] : []),
                ]);
                return {};
            }}
        />
    );
}
SetupCommand.useShell = false;
export default SetupCommand;
