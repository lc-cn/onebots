import { CommandRunner } from "../cli/command-runner.js";
import { stopService } from "../cli/command-application.js";
import { scopeOptions, type ScopeOptions } from "../cli/command-options.js";

export const description = "停止 OneBots 服务";
export const options = scopeOptions;

export default function StopCommand({ options: input }: { options: ScopeOptions }) {
    return <CommandRunner execute={() => stopService(input)} pending="正在停止服务…" />;
}
