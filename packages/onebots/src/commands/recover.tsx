import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { managerServiceRecoveryCommand } from "../cli/manager-service-recovery-command.js";

export const description = "对账服务操作（不重放），或显式取消、回退旧服务迁移";
export const options = z
    .object({
        operation: z
            .string()
            .regex(/^[A-Za-z0-9_-]{1,128}$/)
            .describe(option({ description: "待对账操作 ID（必填）", valueDescription: "id" })),
        system: z.boolean().describe(option({ description: "对账系统级服务（默认用户级）" })),
        cancelMigration: z
            .boolean()
            .default(false)
            .describe(option({ description: "仅取消尚未停服且旧基线未变的迁移，保留备份与工件" })),
        rollbackMigration: z
            .boolean()
            .default(false)
            .describe(
                option({
                    description: "恢复已停止的旧服务；迁移前正在运行时会重新启动旧服务",
                }),
            ),
    })
    .strict()
    .refine(value => !(value.cancelMigration && value.rollbackMigration), {
        message: "--cancel-migration 与 --rollback-migration 不能同时使用",
    });
export default function RecoverCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={() => managerServiceRecoveryCommand(input)}
            pending={
                input.rollbackMigration
                    ? "正在核验并恢复保留的旧服务，迁移前正在运行时会重新启动…"
                    : "正在核验操作是否已达到目标，不重放系统动作…"
            }
        />
    );
}
