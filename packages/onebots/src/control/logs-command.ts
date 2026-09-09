import path from "node:path";
import { sanitizeLogText, type ControlClient } from "@onebots/core/control";
import { createLocalControlClient } from "../client/local-control.js";
import { writeCliOutput } from "../cli-output.js";

export async function runLogsCommand(
    args: string[],
    createClient: (workspace: string) => {
        logs: Pick<ControlClient["logs"], "gateway">;
    } = createLocalControlClient,
    output: (text: string) => void = writeCliOutput,
): Promise<void> {
    if (
        args.length !== 0 &&
        !(args.length === 2 && args[0] === "--data-dir" && args[1] && !args[1].startsWith("--"))
    )
        throw new Error("日志命令只接受 --data-dir 工作区。");
    try {
        const result = await createClient(
            path.resolve(args[1] ?? process.env.ONEBOTS_WORKSPACE ?? process.cwd()),
        ).logs.gateway();
        output(result.exists ? sanitizeLogText(result.text) : "网关尚未生成日志。");
        if (result.truncated) output("仅显示最近 64 KiB 日志。");
    } catch {
        throw new Error("无法读取网关日志，请检查管理会话和服务状态。");
    }
}
