import { CommandRunner } from "../cli/command-runner.js";
import { managerServiceCommand } from "../cli/manager-service-command.js";
import { scopeOptions, type ScopeOptions } from "../cli/command-options.js";

export const description = "启动 OneBots 管理服务，保留网关期望状态";
export const options = scopeOptions;

export default function StartCommand({ options: input }: { options: ScopeOptions }) {
    return (
        <CommandRunner
            execute={() => managerServiceCommand("start", input)}
            pending="正在启动管理服务…"
        />
    );
}
