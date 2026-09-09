import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { managerServiceRecoveryCommand } from "../cli/manager-service-recovery-command.js";

export const description = "对账服务操作（不重放），或显式回退管理升级与旧服务迁移";
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
        rollbackUpgrade: z
            .boolean()
            .default(false)
            .describe(
                option({
                    description: "安全停止失败候选并恢复升级前的管理程序与运行意图",
                }),
            ),
    })
    .strict()
    .refine(
        value =>
            [value.cancelMigration, value.rollbackMigration, value.rollbackUpgrade].filter(Boolean)
                .length <= 1,
        {
            message: "迁移取消、迁移回退与管理程序升级回退不能同时使用",
        },
    );
export default function RecoverCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={() => managerServiceRecoveryCommand(input)}
            pending={
                input.rollbackUpgrade
                    ? "正在核验失败候选并恢复升级前的管理程序与运行意图…"
                    : input.rollbackMigration
                      ? "正在核验并恢复保留的旧服务，迁移前正在运行时会重新启动…"
                      : "正在核验操作是否已达到目标，不重放系统动作…"
            }
        />
    );
}
