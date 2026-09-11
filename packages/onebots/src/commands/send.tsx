import { argument } from "pastel";
import { z } from "zod";
import { CommandRunner } from "../cli/command-runner.js";
import { runManagerSend } from "../cli/manager-send.js";
export const description = "经管理服务发送消息或查询原操作；不启动账号，不重发未知结果";
export const options = z
    .object({
        dataDir: z.string().optional(),
        account: z.string().optional(),
        targetType: z.enum(["private", "group", "channel"]).optional(),
        targetIdType: z.enum(["string", "number"]).optional(),
        operationId: z.string().optional(),
        json: z.boolean(),
    })
    .strict();
export const args = z.tuple([
    z
        .string()
        .optional()
        .describe(argument({ name: "TARGET" })),
    z
        .string()
        .optional()
        .describe(argument({ name: "MESSAGE" })),
]);
export default function SendCommand({
    options: input,
    args: positional,
}: {
    options: z.infer<typeof options>;
    args: z.infer<typeof args>;
}) {
    const flags = Object.entries(input).flatMap(([key, value]) =>
        value === undefined || value === false
            ? []
            : key === "json"
              ? ["--json"]
              : [`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, String(value)],
    );
    return (
        <CommandRunner
            execute={async () => ({
                exitCode: await runManagerSend([
                    ...flags,
                    "--",
                    ...positional.filter((value): value is string => value !== undefined),
                ]),
            })}
        />
    );
}
