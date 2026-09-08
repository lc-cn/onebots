import { CommandRunner } from "../cli/command-runner.js";
import { installManagerServiceCommand } from "../cli/manager-service-install-command.js";
import { option } from "pastel";
import { z } from "zod";

export const description = "安装 OneBots 常驻管理服务（不启动、不读取业务配置）";
export const options = z
    .object({
        dataDir: z
            .string()
            .optional()
            .describe(option({ description: "管理服务工作区目录", valueDescription: "path" })),
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
        system: z
            .boolean()
            .default(false)
            .describe(option({ description: "安装系统级服务（默认用户级）" })),
    })
    .strict();

export default function InstallCommand({ options: input }: { options: z.infer<typeof options> }) {
    return (
        <CommandRunner
            execute={() => installManagerServiceCommand(input)}
            pending="正在安装管理服务…"
        />
    );
}
