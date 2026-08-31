import { CommandRunner } from "../cli/command-runner.js";
import { serviceStatus } from "../cli/command-application.js";
import { scopeOptions, type ScopeOptions } from "../cli/command-options.js";

export const description = "查看 OneBots 服务状态";
export const options = scopeOptions;

export default function StatusCommand({ options: input }: { options: ScopeOptions }) {
    return <CommandRunner execute={() => serviceStatus(input)} />;
}
