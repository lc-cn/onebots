import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { CliError, serviceConfigPath, scopeFrom } from "../cli/command-application.js";
import { scopedRuntimeOptions } from "../cli/command-options.js";
import { getWebUrl, OneBotsDashboard, openWeb } from "../ui.js";
import * as fs from "node:fs";
import { useState } from "react";
import { OneBotsTui } from "../tui/app.js";

export const description = "打开 OneBots 终端运维面板";
export const options = scopedRuntimeOptions.extend({
    web: z.boolean().describe(option({ description: "直接打开 Web 管理端" })),
});

function UiCommand({ options: input }: { options: z.infer<typeof options> }) {
    const configPath = serviceConfigPath(input);
    const [manage, setManage] = useState(!fs.existsSync(configPath));
    const url = getWebUrl(configPath);
    if (input.web) {
        return (
            <CommandRunner
                execute={async () => {
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
    if (manage) return <OneBotsTui configPath={configPath} system={input.system} />;
    return (
        <OneBotsDashboard
            configPath={configPath}
            scope={scopeFrom(input)}
            url={url}
            onManage={() => setManage(true)}
        />
    );
}
UiCommand.useShell = false;
export default UiCommand;
