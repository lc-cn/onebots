import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { CliError, serviceConfigPath } from "../cli/command-application.js";
import { scopedRuntimeOptions } from "../cli/command-options.js";
import { getWebUrl, openWeb } from "../ui.js";
import { OneBotsTui } from "../tui/app.js";

export const description = "打开 OneBots 工作台";
export const options = scopedRuntimeOptions.extend({
    setup: z.boolean().describe(option({ description: "进入扩展安装页" })),
    configure: z.boolean().describe(option({ description: "进入账号配置页" })),
    web: z.boolean().describe(option({ description: "直接打开 Web 管理端" })),
});

function UiCommand({ options: input }: { options: z.infer<typeof options> }) {
    const configPath = serviceConfigPath(input);
    if (input.web) {
        return (
            <CommandRunner
                execute={async () => {
                    const url = getWebUrl(configPath);
                    try {
                        await openWeb(url);
                        return { output: `已打开 ${url}` };
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        return { output: `无法打开浏览器（${message}），请访问: ${url}` };
                    }
                }}
            />
        );
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return (
            <CommandRunner
                execute={() => {
                    throw new CliError("onebots ui 需要交互式终端；可使用 onebots ui --web");
                }}
            />
        );
    }
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
            configPath={configPath}
            system={input.system}
            setup={input.setup}
            configure={input.configure}
            selection={selection}
        />
    );
}
UiCommand.useShell = false;
export default UiCommand;
