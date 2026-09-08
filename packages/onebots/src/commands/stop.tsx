import { CommandRunner } from "../cli/command-runner.js";
import { managerServiceCommand } from "../cli/manager-service-command.js";
import { scopeOptions, type ScopeOptions } from "../cli/command-options.js";

export const description = "停止 OneBots 管理服务，保留网关期望状态";
export const options = scopeOptions;

export default function StopCommand({ options: input }: { options: ScopeOptions }) {
    return (
        <CommandRunner
            execute={() => managerServiceCommand("stop", input)}
            pending="正在停止管理服务…"
        />
    );
}
