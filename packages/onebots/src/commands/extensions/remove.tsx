import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../../cli/command-runner.js";
import { runManagerExtensions } from "../../cli/manager-extensions.js";

export const description = "通过不可变候选移除未被配置引用的扩展";
export const options = z.object({
    dataDir: z
        .string()
        .optional()
        .describe(option({ description: "管理服务工作区" })),
    adapter: z
        .string()
        .optional()
        .describe(option({ description: "适配器名称，逗号分隔" })),
    protocol: z
        .string()
        .optional()
        .describe(option({ description: "协议名称，逗号分隔" })),
    framework: z
        .string()
        .optional()
        .describe(option({ description: "框架名称，逗号分隔" })),
    planOnly: z.boolean().describe(option({ description: "只输出候选计划" })),
});

function ExtensionsRemoveCommand({ options: input }: { options: z.infer<typeof options> }) {
    const values = Object.entries(input).flatMap(([key, value]) =>
        value === undefined || value === false
            ? []
            : value === true
              ? [`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`]
              : [`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, String(value)],
    );
    return (
        <CommandRunner
            execute={async () => ({
                exitCode: await runManagerExtensions(["remove", ...values]),
            })}
            machineReadable={input.planOnly}
        />
    );
}
ExtensionsRemoveCommand.useShell = false;
export default ExtensionsRemoveCommand;
