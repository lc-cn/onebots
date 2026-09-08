import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { migrateServiceCommand } from "../cli/service-migration-command.js";

export const description = "将已安装的旧服务迁移到常驻管理服务，保留工作区与启停状态";
export const options = z
    .object({
        system: z.boolean().describe(option({ description: "迁移系统级服务（默认用户级）" })),
        host: z
            .string()
            .default("127.0.0.1")
            .describe(option({ description: "管理服务监听地址", valueDescription: "host" })),
        port: z
            .number()
            .int()
            .min(1)
            .max(65535)
            .default(6727)
            .describe(option({ description: "管理服务端口", valueDescription: "port" })),
    })
    .strict();
export default function MigrateCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={() => migrateServiceCommand(input)}
            pending="正在迁移已安装的旧服务…"
        />
    );
}
