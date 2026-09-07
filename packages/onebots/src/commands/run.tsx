import { CommandRunner } from "../cli/command-runner.js";
import { runForeground } from "../cli/command-application.js";
import { runtimeOptions, type RuntimeOptions } from "../cli/command-options.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { OneBotsTui } from "../tui/app.js";

export const description = "前台运行 OneBots 桥接服务";
export const isDefault = true;
export const options = runtimeOptions;

function RunCommand({ options: input }: { options: RuntimeOptions }) {
    const configPath = path.resolve(input.config ?? "config.yaml");
    if (process.stdin.isTTY && process.stdout.isTTY && !fs.existsSync(configPath))
        return (
            <OneBotsTui
                configPath={configPath}
                setup
                selection={{
                    adapters: input.register,
                    protocols: input.protocol,
                    applications: input.target ?? [],
                }}
            />
        );
    return <CommandRunner execute={() => runForeground(input)} pending="正在启动 OneBots…" />;
}
RunCommand.useShell = false;
export default RunCommand;
