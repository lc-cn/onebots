import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { updatePackages } from "../cli/command-application.js";
import { scopedRuntimeOptions } from "../cli/command-options.js";

export const description = "检查并更新 OneBots 与已用插件";
export const options = scopedRuntimeOptions.extend({
    check: z.boolean().describe(option({ description: "仅检查可用更新（有更新时退出 2）" })),
    yes: z.boolean().describe(option({ description: "非交互确认更新" })),
});

export default function UpdateCommand({ options: input }: { options: z.infer<typeof options> }) {
    return <CommandRunner execute={() => updatePackages(input)} pending="正在检查更新…" />;
}
