import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { runManagerUpdate } from "../cli/manager-update.js";

export const description = "检查并升级网关运行版本，或安全切换本机常驻管理程序";
export const options = z
    .object({
        dataDir: z
            .string()
            .optional()
            .describe(option({ description: "管理服务工作区" })),
        check: z.boolean().describe(option({ description: "只检查网关更新，有更新退出 2" })),
        manager: z.boolean().describe(option({ description: "检查或升级本机常驻管理程序" })),
        version: z
            .string()
            .optional()
            .describe(option({ description: "管理程序精确目标版本" })),
        yes: z.boolean().describe(option({ description: "非交互确认管理程序版本摘要" })),
        system: z.boolean().describe(option({ description: "操作系统级管理服务" })),
        operation: z
            .string()
            .optional()
            .describe(option({ description: "查询原管理程序升级操作" })),
    })
    .strict();
export default function UpdateCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={async () => ({
                exitCode: await runManagerUpdate([
                    ...(input.dataDir ? ["--data-dir", input.dataDir] : []),
                    ...(input.check ? ["--check"] : []),
                    ...(input.manager ? ["--manager"] : []),
                    ...(input.version ? ["--version", input.version] : []),
                    ...(input.yes ? ["--yes"] : []),
                    ...(input.system ? ["--system"] : []),
                    ...(input.operation ? ["--operation", input.operation] : []),
                ]),
            })}
            pending="正在检查网关运行版本…"
        />
    );
}
