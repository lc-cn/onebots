import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { showCapabilities } from "../cli/command-application.js";
import { runtimeOptions } from "../cli/command-options.js";

export const description = "导出适配器默认能力清单";
export const options = runtimeOptions.pick({ config: true, register: true }).extend({
    json: z.boolean().describe(option({ description: "输出 JSON" })),
});

export default function CapabilitiesCommand({
    options: input,
}: {
    options: z.infer<typeof options>;
}) {
    return (
        <CommandRunner
            execute={() => showCapabilities({ ...input, protocol: [] })}
            pending="正在加载适配器能力清单…"
        />
    );
}
