import { CommandRunner } from "../cli/command-runner.js";
import { runForeground } from "../cli/command-application.js";
import { runtimeOptions, type RuntimeOptions } from "../cli/command-options.js";

export const description = "前台运行 OneBots 桥接服务";
export const isDefault = true;
export const options = runtimeOptions;

function RunCommand({ options: input }: { options: RuntimeOptions }) {
    return <CommandRunner execute={() => runForeground(input)} pending="正在启动 OneBots…" />;
}
RunCommand.useShell = false;
export default RunCommand;
