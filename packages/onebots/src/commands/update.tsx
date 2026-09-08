import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { runManagerUpdate } from "../cli/manager-update.js";

export const description = "通过管理服务检查并升级网关运行版本（不更新管理服务程序）";
export const options = z
    .object({
        dataDir: z
            .string()
            .optional()
            .describe(option({ description: "管理服务工作区" })),
        check: z.boolean().describe(option({ description: "只检查网关更新，有更新退出 2" })),
    })
    .strict();
export default function UpdateCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={async () => ({
                exitCode: await runManagerUpdate([
                    ...(input.dataDir ? ["--data-dir", input.dataDir] : []),
                    ...(input.check ? ["--check"] : []),
                ]),
            })}
            pending="正在检查网关运行版本…"
        />
    );
}
