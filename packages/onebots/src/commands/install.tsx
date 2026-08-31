import { CommandRunner } from "../cli/command-runner.js";
import { installService } from "../cli/command-application.js";
import { scopedRuntimeOptions } from "../cli/command-options.js";
import type { z } from "zod";

export const description = "安装 OneBots 守护服务";
export const options = scopedRuntimeOptions;

export default function InstallCommand({ options: input }: { options: z.infer<typeof options> }) {
    return <CommandRunner execute={() => installService(input)} pending="正在安装服务…" />;
}
