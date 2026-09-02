import { CommandRunner } from "../cli/command-runner.js";
import { serviceStatus } from "../cli/command-application.js";
import { scopeOptions } from "../cli/command-options.js";
import { option } from "pastel";
import { z } from "zod";

export const description = "查看 OneBots 进程、存活与就绪状态";
export const options = scopeOptions.extend({
    json: z.boolean().describe(option({ description: "输出 JSON" })),
});

export default function StatusCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={() => serviceStatus(input)}
            pending="正在检查服务状态…"
            machineReadable={input.json}
        />
    );
}
