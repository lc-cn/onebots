import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { runManagerForeground } from "../cli/manager-foreground.js";

export const description = "启动常驻管理服务（serve 别名）";
export const isDefault = true;
export const options = z.object({
    dataDir: z.string().optional(),
    host: z.string().optional(),
    port: z.string().optional(),
});
function RunCommand({ options: input }: { options: z.infer<typeof options> }) {
    const args = Object.entries(input).flatMap(([key, value]) =>
        value === undefined ? [] : [key === "dataDir" ? "--data-dir" : `--${key}`, value],
    );
    return (
        <CommandRunner
            execute={async () => {
                await runManagerForeground(args);
                return {};
            }}
            pending="正在启动管理服务…"
        />
    );
}
RunCommand.useShell = false;
export default RunCommand;
