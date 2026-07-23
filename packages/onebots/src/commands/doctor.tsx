import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { diagnose } from "../cli/command-application.js";
import { scopedRuntimeOptions } from "../cli/command-options.js";

export const description = "诊断 OneBots 配置与服务";
export const options = scopedRuntimeOptions.extend({
    fix: z.boolean().describe(option({ description: "修复安全且无破坏性的问题" })),
    json: z.boolean().describe(option({ description: "输出 JSON" })),
});

export default function DoctorCommand({ options: input }: { options: z.infer<typeof options> }) {
    return <CommandRunner execute={() => diagnose(input)} pending="正在诊断 OneBots…" />;
}
