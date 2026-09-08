import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { managerDoctorCommand } from "../cli/manager-doctor-command.js";
export const description =
    "诊断管理服务与网关；前台或 Docker 使用 --data-dir（旧 -c/-r/-p 已移除）";
export const options = z
    .object({
        dataDir: z
            .string()
            .optional()
            .describe(
                option({ description: "现有工作区（前台或 Docker）", valueDescription: "path" }),
            ),
        system: z.boolean().describe(option({ description: "诊断系统级管理服务" })),
        fix: z.boolean().describe(option({ description: "旧自动修复已停用；使用显式修复流程" })),
        json: z.boolean().describe(option({ description: "输出单一 JSON 报告" })),
        strict: z.boolean().describe(option({ description: "将未验证或警告视为失败" })),
    })
    .strict();
export default function DoctorCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={() => managerDoctorCommand(input)}
            pending="正在诊断管理服务与网关…"
            machineReadable={input.json}
        />
    );
}
