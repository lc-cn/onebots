import { CommandRunner } from "../cli/command-runner.js";
import { serviceStatus } from "../cli/command-application.js";
import { scopeOptions, type ScopeOptions } from "../cli/command-options.js";

export const description = "查看 OneBots 进程、存活与就绪状态";
export const options = scopeOptions;

export default function StatusCommand({ options: input }: { options: ScopeOptions }) {
    return <CommandRunner execute={() => serviceStatus(input)} pending="正在检查服务状态…" />;
}
