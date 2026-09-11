import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../../cli/command-runner.js";
import { runManagerExtensions } from "../../cli/manager-extensions.js";

export const description = "通过管理服务选择并安装扩展候选";
export const options = z.object({
    dataDir: z
        .string()
        .optional()
        .describe(option({ description: "管理服务工作区" })),
});

function ExtensionsInstallCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={async () => ({
                exitCode: await runManagerExtensions([
                    "install",
                    ...(input.dataDir ? ["--data-dir", input.dataDir] : []),
                ]),
            })}
        />
    );
}
ExtensionsInstallCommand.useShell = false;
export default ExtensionsInstallCommand;
