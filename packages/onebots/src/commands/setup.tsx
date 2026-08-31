import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { setupConfiguration } from "../cli/command-application.js";
import { runtimeOptions } from "../cli/command-options.js";

export const description = "引导创建或更新 OneBots 配置";
export const options = runtimeOptions.extend({
    force: z.boolean().describe(option({ description: "备份后覆盖已有配置" })),
});

export default function SetupCommand({ options: input }: { options: z.infer<typeof options> }) {
    return <CommandRunner execute={() => setupConfiguration(input)} />;
}
