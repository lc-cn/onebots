import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { CliError, serviceConfigPath } from "../cli/command-application.js";
import { scopedRuntimeOptions } from "../cli/command-options.js";
import { OneBotsTui } from "../tui/app.js";

export const description = "交互式安装、配置与管理 OneBots";
export const options = scopedRuntimeOptions.extend({
    setup: z.boolean().describe(option({ description: "重新进入依赖选择与安装向导" })),
    configure: z.boolean().describe(option({ description: "验证已有依赖后直接配置账号与协议" })),
});

function TuiCommand({ options: input }: { options: z.infer<typeof options> }) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        return (
            <CommandRunner
                execute={() => {
                    throw new CliError(
                        "onebots tui 需要交互式终端；自动化部署请使用 setup、install 等命令",
                    );
                }}
            />
        );
    const selection =
        input.register.length || input.protocol.length || input.target?.length
            ? {
                  adapters: input.register,
                  protocols: input.protocol,
                  applications: input.target ?? [],
              }
            : undefined;
    return (
        <OneBotsTui
            configPath={serviceConfigPath(input)}
            system={input.system}
            setup={input.setup}
            configure={input.configure}
            selection={selection}
        />
    );
}
TuiCommand.useShell = false;
export default TuiCommand;
