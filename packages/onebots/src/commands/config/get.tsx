import { argument } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../../cli/command-runner.js";
import { getConfig } from "../../cli/command-application.js";
import { runtimeOptions, type RuntimeOptions } from "../../cli/command-options.js";

export const description = "读取配置项";
export const options = runtimeOptions;
export const args = z.tuple([z.string().describe(argument({ name: "key" }))]);

export default function ConfigGetCommand({ options: input, args: [key] }: { options: RuntimeOptions; args: z.infer<typeof args> }) {
    return <CommandRunner execute={() => getConfig(input, key)} />;
}
