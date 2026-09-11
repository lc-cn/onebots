import { CommandRunner } from "../cli/command-runner.js";
import { managerServiceCommand } from "../cli/manager-service-command.js";
import { scopeOptions, type ScopeOptions } from "../cli/command-options.js";

export const description = "重启 OneBots 管理服务，保留网关期望状态";
export const options = scopeOptions;

export default function RestartCommand({ options: input }: { options: ScopeOptions }) {
    return (
        <CommandRunner
            execute={() => managerServiceCommand("restart", input)}
            pending="正在重启管理服务…"
        />
    );
}
