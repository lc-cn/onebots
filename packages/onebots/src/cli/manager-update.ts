import path from "node:path";
import type { ControlClient } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";
import { createLocalControlClient } from "../client/local-control.js";
import { createControlTerminalPrompt } from "../control/tui-terminal.js";
import { runControlUpdate } from "../control/tui-update.js";
import { writeCliOutput } from "../cli-output.js";

export const UPDATE_HELP = `onebots update [--data-dir 工作区] [--check]
通过管理服务检查并升级网关运行版本，保留已安装扩展和网关启停意图。
--check 只输出版本计划；有更新退出 2，无更新退出 0，不安装或激活。
交互模式分别确认安装和激活；非交互安装请使用 control plan-update/install/installation/activate。
本命令不升级常驻管理服务或 CLI 程序。Docker/HF 请替换镜像并保留数据卷；本机管理程序升级事务尚未提供。
不支持旧 --yes、--packages-only、--system 或 -c/-r/-p/-t；不修改原运行目录或系统服务定义。`;

export async function runManagerUpdate(
    args: string[],
    options: {
        interactive?: boolean;
        client?(workspace: string): ControlClient;
        prompt?: TuiPrompt;
        output?(value: string): void;
    } = {},
): Promise<number> {
    let workspace = process.env.ONEBOTS_WORKSPACE ?? process.cwd();
    let check = false;
    let help = false;
    for (let index = 0; index < args.length; index++) {
        const value = args[index];
        if (value === "--check") check = true;
        else if (value === "--help" || value === "-h") help = true;
        else if (value === "--data-dir" || value.startsWith("--data-dir=")) {
            const directory = value === "--data-dir" ? args[++index] : value.slice(11);
            if (!directory || directory.startsWith("-"))
                throw new Error("--data-dir 需要工作区目录");
            workspace = directory;
        } else
            throw new Error(
                "update 只接受 --data-dir、--check、--help；旧原地更新参数已移除，请查看帮助。未修改依赖或服务。",
            );
    }
    const output = options.output ?? writeCliOutput;
    if (help) {
        output(UPDATE_HELP);
        return 0;
    }
    if (
        !check &&
        !(options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true))
    )
        throw new Error(
            "非交互更新请先用 update --check 检查，再通过 control 安装和激活已确认计划；不会自动更新。",
        );
    const client = (options.client ?? createLocalControlClient)(path.resolve(workspace));
    if (!check) {
        await runControlUpdate(client, options.prompt ?? createControlTerminalPrompt());
        return 0;
    }
    const source = await client.configurationSource();
    if (source.state !== "ready") throw new Error("请先修复配置，再检查网关运行版本更新");
    const plan = await client.planUpdate(source.base);
    output(JSON.stringify({ scope: "gateway", ...plan }));
    return plan.state === "updates_available" ? 2 : 0;
}
