import { CommandRunner } from "../../cli/command-runner.js";
import { listConfig } from "../../cli/command-application.js";
import { runtimeOptions, type RuntimeOptions } from "../../cli/command-options.js";

export const description = "列出完整配置";
export const options = runtimeOptions;

export default function ConfigListCommand({ options: input }: { options: RuntimeOptions }) {
    return <CommandRunner execute={() => listConfig(input)} />;
}
