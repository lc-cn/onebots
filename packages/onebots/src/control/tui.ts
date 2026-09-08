import type { ControlClient } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";
import { runControlConfiguration } from "./tui-configuration.js";
import { createControlTerminalPrompt } from "./tui-terminal.js";
import { runControlInstallation, trackControlInstallation } from "./tui-installation.js";
import { runControlUpdate } from "./tui-update.js";

export interface ControlTuiOptions {
    prompt?: TuiPrompt;
    onConfigure?: (client: ControlClient, prompt: TuiPrompt) => Promise<void>;
}
export async function runControlTui(
    client: ControlClient,
    options: ControlTuiOptions = {},
): Promise<void> {
    const prompt = options.prompt ?? createControlTerminalPrompt();
    while (true) {
        let action: string;
        try {
            [action] = await prompt.ask({
                title: "OneBots 管理工作台",
                choices: [
                    { value: "status", label: "查看状态" },
                    { value: "start", label: "启动网关" },
                    { value: "stop", label: "停止网关" },
                    { value: "restart", label: "重启网关" },
                    { value: "install", label: "选择并安装依赖" },
                    { value: "update", label: "升级网关运行版本" },
                    { value: "track", label: "查询已有安装任务" },
                    { value: "configure", label: "配置账号与协议" },
                    { value: "quit", label: "退出工作台" },
                ],
            });
        } catch {
            return;
        }
        if (action === "quit") return;
        try {
            if (action === "status") {
                const state = await client.status();
                prompt.report(
                    `管理服务在线；网关：${state.gateway.actual}，期望：${state.gateway.desired}${state.gateway.recoveryRequired ? "；需要恢复检查" : ""}`,
                );
            } else if (action === "start" || action === "stop" || action === "restart") {
                const result = await client.gateway(action);
                prompt.report(
                    result.status === "succeeded"
                        ? "操作完成，管理服务保持在线。"
                        : "操作尚未成功，请查询状态。",
                );
            } else if (action === "install") await runControlInstallation(client, prompt);
            else if (action === "update") await runControlUpdate(client, prompt);
            else if (action === "track") {
                const [id] = await prompt.ask({ title: "输入已有安装任务 ID" });
                if (/^[a-zA-Z0-9_-]{1,128}$/.test(id ?? ""))
                    await trackControlInstallation(client, prompt, id);
                else prompt.report("任务 ID 无效。");
            } else if (action === "configure")
                await (options.onConfigure ?? runControlConfiguration)(client, prompt);
        } catch {
            prompt.report("操作已取消或结果暂不可确认。请查询原任务或管理状态，不要重复提交。");
        }
    }
}
