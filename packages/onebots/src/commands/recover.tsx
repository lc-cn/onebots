import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { managerServiceRecoveryCommand } from "../cli/manager-service-recovery-command.js";

export const description = "对账已达到目标的停止或卸载操作（不重放系统动作）";
export const options = z
    .object({
        operation: z
            .string()
            .regex(/^[A-Za-z0-9_-]{1,128}$/)
            .describe(option({ description: "待对账操作 ID（必填）", valueDescription: "id" })),
        system: z.boolean().describe(option({ description: "对账系统级服务（默认用户级）" })),
    })
    .strict();
export default function RecoverCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={() => managerServiceRecoveryCommand(input)}
            pending="正在核验操作是否已达到目标，不重放系统动作…"
        />
    );
}
