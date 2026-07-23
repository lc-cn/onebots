import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { serviceLogs } from "../cli/command-application.js";
import { scopeOptions } from "../cli/command-options.js";

export const description = "查看 OneBots 服务日志";
export const options = scopeOptions.extend({
    follow: z.boolean().describe(option({ alias: "f", description: "持续跟随日志" })),
    lines: z.number().default(100).describe(option({ alias: "n", description: "显示最近行数", valueDescription: "n" })),
});

export default function LogsCommand({ options: input }: { options: z.infer<typeof options> }) {
    return <CommandRunner execute={() => serviceLogs(input)} pending={input.follow ? "正在跟随日志…" : undefined} />;
}
