import { CommandRunner } from "../cli/command-runner.js";
import { startService } from "../cli/command-application.js";
import { scopeOptions, type ScopeOptions } from "../cli/command-options.js";

export const description = "启动已安装的 OneBots 服务";
export const options = scopeOptions;

export default function StartCommand({ options: input }: { options: ScopeOptions }) {
    return <CommandRunner execute={() => startService(input)} pending="正在启动服务…" />;
}
