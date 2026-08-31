import { argument } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../../cli/command-runner.js";
import { setConfig } from "../../cli/command-application.js";
import { runtimeOptions, type RuntimeOptions } from "../../cli/command-options.js";

export const description = "修改配置项（自动备份）";
export const options = runtimeOptions;
export const args = z.tuple([
    z.string().describe(argument({ name: "key" })),
    z.string().describe(argument({ name: "value" })),
]);

export default function ConfigSetCommand({ options: input, args: [key, value] }: { options: RuntimeOptions; args: z.infer<typeof args> }) {
    return <CommandRunner execute={() => setConfig(input, key, value)} />;
}
