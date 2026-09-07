import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { setupConfiguration } from "../cli/command-application.js";
import { runtimeOptions } from "../cli/command-options.js";
import { normalizeRuntimeOptions } from "../cli/command-application.js";
import { OneBotsTui } from "../tui/app.js";

export const description = "引导创建或更新 OneBots 配置";
export const options = runtimeOptions.extend({
    force: z.boolean().describe(option({ description: "备份后覆盖已有配置" })),
    reset: z.boolean().describe(option({ description: "从安全默认值重建配置（需配合 --force）" })),
});

export default function SetupCommand({ options: input }: { options: z.infer<typeof options> }) {
    if (process.stdin.isTTY && process.stdout.isTTY && !input.force && !input.reset) {
        const runtime = normalizeRuntimeOptions(input);
        const selection =
            runtime.adapters.length || runtime.protocols.length || runtime.applications.length
                ? runtime
                : undefined;
        return <OneBotsTui configPath={runtime.configPath} setup selection={selection} />;
    }
    return <CommandRunner execute={() => setupConfiguration(input)} />;
}
