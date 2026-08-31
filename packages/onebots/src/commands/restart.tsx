import { CommandRunner } from "../cli/command-runner.js";
import { restartService } from "../cli/command-application.js";
import { scopeOptions, type ScopeOptions } from "../cli/command-options.js";

export const description = "预检并重启 OneBots 服务";
export const options = scopeOptions;

export default function RestartCommand({ options: input }: { options: ScopeOptions }) {
    return <CommandRunner execute={() => restartService(input)} pending="正在预检并重启服务…" />;
}
