import path from "node:path";
import type { ControlClient } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";
import { createLocalControlClient } from "../client/local-control.js";
import { createControlTerminalPrompt } from "./tui-terminal.js";
import { runControlTui } from "./tui.js";
import { runControlInstallation } from "./tui-installation.js";
import { runControlConfiguration } from "./tui-configuration.js";
import { writeCliOutput } from "../cli-output.js";

export interface ControlTuiCommandOptions {
    interactive?: boolean;
    client?: (workspace: string) => ControlClient;
    prompt?: TuiPrompt;
    output?: (message: string) => void;
}
export function isDirectControlTuiInvocation(argv: string[], interactive: boolean): boolean {
    return (
        ["ui", "tui", "setup"].includes(argv[2]) ||
        (interactive &&
            (!argv[2] ||
                argv[2] === "--setup" ||
                argv[2] === "--configure" ||
                argv[2] === "--data-dir" ||
                argv[2].startsWith("--data-dir=")))
    );
}
/** 顶层 ui/tui 与无参数交互入口共用；不启动服务、不读取旧配置。 */
export async function runControlTuiCommand(
    args: string[],
    options: ControlTuiCommandOptions = {},
): Promise<void> {
    let workspace = process.env.ONEBOTS_WORKSPACE ?? process.cwd();
    let setup = false;
    let configure = false;
    let help = false;
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === "--data-dir" || argument.startsWith("--data-dir=")) {
            const value = argument === "--data-dir" ? args[++index] : argument.slice(11);
            if (!value || value.startsWith("-")) throw new Error("--data-dir 需要工作区目录");
            workspace = value;
        } else if (argument === "--setup") setup = true;
        else if (argument === "--configure") configure = true;
        else if (argument === "--help" || argument === "-h") help = true;
        else if (/^(?:-c|--config(?:=|$))/.test(argument))
            throw new Error(
                "工作台不再直接编辑 -c/--config 文件；请先迁移到管理服务工作区，再使用 --data-dir 连接。不会修改原文件。",
            );
        else if (argument === "--force" || argument === "--reset")
            throw new Error(
                "setup 不再直接覆盖或重建配置文件；请通过管理服务配置草稿验证并确认应用，不支持 --force/--reset。",
            );
        else if (argument === "--web")
            throw new Error(
                "工作台不再从旧配置推导 Web 地址；请访问 onebots serve 配置的管理地址，通过 Web 配对登录。",
            );
        else
            throw new Error(
                "工作台只接受 --data-dir、--setup、--configure、--help；适配器、协议和框架请在安装/配置向导中明确选择，系统托管参数不属于交互工作台。",
            );
    }
    if (help) {
        (options.output ?? writeCliOutput)(
            "onebots ui|tui [--data-dir 工作区] [--setup | --configure]\n连接已运行的管理服务；--setup 进入安装向导，--configure 进入配置草稿。\n先运行 onebots serve --data-dir 工作区；工作台不会自动启动旧网关。",
        );
        return;
    }
    if (setup && configure)
        throw new Error("--setup 与 --configure 请择一使用；两个向导均可从主菜单进入。");
    if (!(options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)))
        throw new Error("onebots ui/tui 需要交互式终端；非交互控制请使用 onebots control。");
    const client = (options.client ?? createLocalControlClient)(path.resolve(workspace));
    try {
        await client.status();
    } catch {
        throw new Error(
            "管理服务不可达；请先在另一个终端运行 onebots serve --data-dir <工作区>，再连接相同工作区。未启动旧网关或修改配置。",
        );
    }
    const prompt = options.prompt ?? createControlTerminalPrompt();
    try {
        if (setup) await runControlInstallation(client, prompt);
        if (configure) await runControlConfiguration(client, prompt);
    } catch {
        prompt.report("向导已取消或结果暂不可确认，请查询原任务或草稿；未自动重试。");
    }
    await runControlTui(client, { prompt });
}
