import path from "node:path";
import {
    controlLogSources,
    sanitizeLogText,
    type ControlClient,
    type ControlLogSource,
} from "@onebots/core/control";
import { createLocalControlClient } from "../client/local-control.js";
import { writeCliOutput } from "../cli-output.js";

export async function runLogsCommand(
    args: string[],
    createClient: (workspace: string) => {
        logs: Pick<ControlClient["logs"], "query">;
    } = createLocalControlClient,
    output: (text: string) => void = writeCliOutput,
): Promise<void> {
    let workspace = process.env.ONEBOTS_WORKSPACE ?? process.cwd();
    let source: ControlLogSource = "gateway";
    const seen = new Set<string>();
    for (let index = 0; index < args.length; index += 2) {
        const option = args[index];
        const value = args[index + 1];
        if (
            !["--data-dir", "--source"].includes(option) ||
            seen.has(option) ||
            !value ||
            value.startsWith("--")
        )
            throw new Error("日志命令只接受 --data-dir 工作区与 --source 日志来源。");
        seen.add(option);
        if (option === "--data-dir") workspace = value;
        else if (controlLogSources.includes(value as ControlLogSource))
            source = value as ControlLogSource;
        else throw new Error("日志来源必须是 manager、gateway 或 operation。");
    }
    try {
        const result = await createClient(path.resolve(workspace)).logs.query({ source });
        const label = { manager: "管理服务", gateway: "网关", operation: "控制操作" }[source];
        output(result.exists ? sanitizeLogText(result.text) : `${label}尚未生成日志。`);
        if (result.truncated) output("仅显示最近 64 KiB 日志。");
    } catch {
        throw new Error("无法读取服务日志，请检查管理会话和服务状态。");
    }
}
