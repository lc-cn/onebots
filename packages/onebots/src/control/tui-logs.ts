import { sanitizeLogText, type ControlClient, type ControlLogSource } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";
import { confirmControlAction } from "./tui-installation.js";

export async function runControlLogs(
    client: { logs: Pick<ControlClient["logs"], "query"> },
    prompt: TuiPrompt,
): Promise<void> {
    if (
        !(await confirmControlAction(
            prompt,
            "查看服务日志",
            "日志可能包含平台凭据和消息内容，请勿直接分享。仅读取最近 64 KiB。",
        ))
    )
        return;
    const [source] = await prompt.ask({
        title: "选择日志来源",
        choices: [
            { value: "manager", label: "管理服务" },
            { value: "gateway", label: "网关" },
            { value: "operation", label: "控制操作" },
        ],
    });
    try {
        const selected = source as ControlLogSource;
        const result = await client.logs.query({ source: selected });
        const label = { manager: "管理服务", gateway: "网关", operation: "控制操作" }[selected];
        prompt.report(result.exists ? sanitizeLogText(result.text) : `${label}尚未生成日志。`);
        if (result.truncated) prompt.report("仅显示最近 64 KiB 日志。");
    } catch {
        prompt.report("无法读取服务日志，请检查管理会话和服务状态。");
    }
}
