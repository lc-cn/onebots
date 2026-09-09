import path from "node:path";
import type { ControlClient } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";
import { createLocalControlClient } from "../client/local-control.js";
import { createControlTerminalPrompt } from "../control/tui-terminal.js";
import { runControlUpdate } from "../control/tui-update.js";
import { writeCliOutput } from "../cli-output.js";
import {
    runManagerProgramUpdate,
    type ManagerProgramUpdateDependencies,
} from "./manager-program-update.js";

export const UPDATE_HELP = `onebots update [--data-dir 工作区] [--check]
通过管理服务检查并升级网关运行版本，保留已安装扩展和网关启停意图。
--check 只输出版本计划；有更新退出 2，无更新退出 0，不安装或激活。
交互模式分别确认安装和激活；非交互安装请使用 control plan-update/install/installation/activate。

onebots update --manager [--check] [--version 精确版本] [--yes] [--system]
通过 CLI 升级本机常驻管理程序；只支持 Linux/macOS。--check 不下载或切换。
交互模式显示当前/目标版本及发布归档摘要后确认；非交互必须显式传入 --yes。
结果未知时使用原操作 ID：候选阶段追加 --operation ID 离线核对候选并继续同一切换（--version 仅作一致性校验）；系统服务阶段用 recover 对账。
管理程序使用独立不可变候选，不在原目录执行 npm install。Docker/HF 请替换镜像并保留数据卷。
网关模式不支持旧 --yes、--packages-only、--system 或 -c/-r/-p/-t。`;

export async function runManagerUpdate(
    args: string[],
    options: {
        interactive?: boolean;
        client?(workspace: string): ControlClient;
        prompt?: TuiPrompt;
        output?(value: string): void;
        managerDependencies?: Partial<ManagerProgramUpdateDependencies>;
    } = {},
): Promise<number> {
    let workspace = process.env.ONEBOTS_WORKSPACE ?? process.cwd();
    let check = false;
    let help = false;
    let manager = false;
    let yes = false;
    let system = false;
    let version: string | undefined;
    let operationId: string | undefined;
    let dataDirProvided = false;
    for (let index = 0; index < args.length; index++) {
        const value = args[index];
        if (value === "--check") check = true;
        else if (value === "--manager") manager = true;
        else if (value === "--yes") yes = true;
        else if (value === "--system") system = true;
        else if (value === "--help" || value === "-h") help = true;
        else if (value === "--version" || value.startsWith("--version=")) {
            const target = value === "--version" ? args[++index] : value.slice(10);
            if (!target || target.startsWith("-")) throw new Error("--version 需要精确版本");
            version = target;
        } else if (value === "--operation" || value.startsWith("--operation=")) {
            const id = value === "--operation" ? args[++index] : value.slice(12);
            if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id))
                throw new Error("--operation 需要有效的原操作 ID");
            operationId = id;
        } else if (value === "--data-dir" || value.startsWith("--data-dir=")) {
            dataDirProvided = true;
            const directory = value === "--data-dir" ? args[++index] : value.slice(11);
            if (!directory || directory.startsWith("-"))
                throw new Error("--data-dir 需要工作区目录");
            workspace = directory;
        } else
            throw new Error(
                "update 参数无效；请查看 --help。旧原地更新参数已移除，未修改依赖或服务。",
            );
    }
    const output = options.output ?? writeCliOutput;
    if (help) {
        output(UPDATE_HELP);
        return 0;
    }
    const interactive =
        options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
    if (manager) {
        if (dataDirProvided)
            throw new Error("--data-dir 仅用于网关更新；管理程序由 --system 选择服务范围");
        if (check && operationId)
            throw new Error("--operation 用于恢复原升级，不能与只读 --check 同时使用");
        return runManagerProgramUpdate(
            {
                check,
                yes,
                system,
                ...(version ? { version } : {}),
                ...(operationId ? { operationId } : {}),
            },
            {
                ...options.managerDependencies,
                interactive,
                output,
                ...(interactive ? { prompt: options.prompt ?? createControlTerminalPrompt() } : {}),
            },
        );
    }
    if (yes || system || version || operationId)
        throw new Error(
            "--yes、--system、--version 和 --operation 仅可与 --manager 一起使用；未执行更新",
        );
    if (!check && !interactive)
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
