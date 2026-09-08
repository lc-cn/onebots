import { CommandRunner } from "../cli/command-runner.js";
import { managerServiceUninstallCommand } from "../cli/manager-service-uninstall-command.js";
import { scopeOptions, type ScopeOptions } from "../cli/command-options.js";

export const description = "卸载 OneBots 服务（保留用户数据）";
export const options = scopeOptions;

export default function UninstallCommand({ options: input }: { options: ScopeOptions }) {
    return (
        <CommandRunner
            execute={() => managerServiceUninstallCommand(input)}
            pending="正在卸载系统托管并保留工作区…"
        />
    );
}
