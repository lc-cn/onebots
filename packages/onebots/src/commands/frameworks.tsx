import { option } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { showFrameworkConnections } from "../cli/framework-command.js";

export const description = "列出机器人框架接入面或生成连接配置";
export const options = z.object({
    framework: z
        .enum(["koishi", "nonebot", "karin", "zhin", "alemonjs", "yunzai", "zhenxun"])
        .optional()
        .describe(option({ description: "目标机器人框架", valueDescription: "name" })),
    account: z
        .string()
        .optional()
        .describe(
            option({
                description: "OneBots 账号 platform.account_id",
                valueDescription: "account",
            }),
        ),
    origin: z
        .string()
        .optional()
        .describe(
            option({ description: "OneBots 对框架可达的 HTTP origin", valueDescription: "url" }),
        ),
    framework_origin: z
        .string()
        .optional()
        .describe(option({ description: "反向连接时的框架 HTTP origin", valueDescription: "url" })),
    json: z.boolean().describe(option({ description: "输出 JSON" })),
});

export default function FrameworksCommand({
    options: input,
}: {
    options: z.infer<typeof options>;
}) {
    return (
        <CommandRunner
            execute={() => showFrameworkConnections(input)}
            machineReadable={input.json}
        />
    );
}
