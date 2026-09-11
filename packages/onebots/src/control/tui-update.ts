import type { ControlClient } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";
import {
    confirmControlInstallation,
    type ControlInstallationTuiOptions,
} from "./tui-installation.js";

export async function runControlUpdate(
    client: ControlClient,
    prompt: TuiPrompt,
    options: ControlInstallationTuiOptions = {},
): Promise<void> {
    const source = await client.configurationSource();
    if (source.state !== "ready") {
        prompt.report("请先修复配置，再检查网关运行版本更新。");
        return;
    }
    prompt.report("检查网关运行版本；不更新常驻管理服务或 CLI 程序，不自动启用账号和协议。");
    const update = await client.planUpdate(source.base);
    if (update.state === "current") {
        prompt.report("网关运行版本已是最新，无需安装。");
        return;
    }
    if (!update.installationPlan) throw new Error("升级计划缺少安装确认记录");
    prompt.report(
        update.packages
            .map(item => `${item.name}：${item.current ?? "未安装"} → ${item.target}`)
            .join("\n"),
    );
    await confirmControlInstallation(client, prompt, update.installationPlan, options);
}
