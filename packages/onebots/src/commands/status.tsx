import { CommandRunner } from "../cli/command-runner.js";
import { managerServiceStatusCommand } from "../cli/manager-service-status-command.js";
import { scopeOptions } from "../cli/command-options.js";
import { option } from "pastel";
import { z } from "zod";

export const description = "分别查看管理服务与网关状态";
export const options = scopeOptions.extend({
    json: z.boolean().describe(option({ description: "输出 JSON" })),
});

export default function StatusCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={() => managerServiceStatusCommand(input)}
            pending="正在检查服务状态…"
            machineReadable={input.json}
        />
    );
}
