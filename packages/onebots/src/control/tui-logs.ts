import { sanitizeLogText, type ControlClient } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";
import { confirmControlAction } from "./tui-installation.js";

export async function runControlLogs(
    client: { logs: Pick<ControlClient["logs"], "gateway"> },
    prompt: TuiPrompt,
): Promise<void> {
    if (
        !(await confirmControlAction(
            prompt,
            "查看网关日志",
            "日志可能包含平台凭据和消息内容，请勿直接分享。仅读取最近 64 KiB。",
        ))
    )
        return;
    try {
        const result = await client.logs.gateway();
        prompt.report(result.exists ? sanitizeLogText(result.text) : "网关尚未生成日志。");
        if (result.truncated) prompt.report("仅显示最近 64 KiB 日志。");
    } catch {
        prompt.report("无法读取网关日志，请检查管理会话和服务状态。");
    }
}
