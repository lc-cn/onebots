import { CommandRunner } from "../cli/command-runner.js";
import { uninstallService } from "../cli/command-application.js";
import { scopeOptions, type ScopeOptions } from "../cli/command-options.js";

export const description = "卸载 OneBots 服务（保留用户数据）";
export const options = scopeOptions;

export default function UninstallCommand({ options: input }: { options: ScopeOptions }) {
    return <CommandRunner execute={() => uninstallService(input)} pending="正在卸载服务…" />;
}
