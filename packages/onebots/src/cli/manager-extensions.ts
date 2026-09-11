import path from "node:path";
import type { ControlClient, ControlExtensionSelection } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";
import { createLocalControlClient } from "../client/local-control.js";
import { createControlTerminalPrompt } from "../control/tui-terminal.js";
import { confirmControlInstallation, runControlInstallation } from "../control/tui-installation.js";
import { writeCliOutput } from "../cli-output.js";

export const EXTENSIONS_HELP = `onebots extensions install [--data-dir 工作区]
交互选择完整扩展集合，安装和验证新候选，再单独确认激活。

onebots extensions remove --adapter 名称[,名称] --protocol 名称[,名称] --framework 名称[,名称] [--data-dir 工作区] [--plan-only]
从当前完整集合中移除指定扩展，通过不可变候选安装、验证和单独激活完成；不会原地删包或修改配置。
被账号、协议或 plugins 引用的扩展会被拒绝，请先在配置管理中删除引用并应用配置。
--plan-only 只输出计划；后续使用 control install/installation/activate 处理同一计划。`;

interface ManagerExtensionsDependencies {
    interactive?: boolean;
    client?(workspace: string): ControlClient;
    prompt?: TuiPrompt;
    output?(value: string): void;
}

interface ExtensionCommandOptions {
    action: "install" | "remove";
    workspace: string;
    planOnly: boolean;
    removal: ControlExtensionSelection;
}

export async function runManagerExtensions(
    args: string[],
    dependencies: ManagerExtensionsDependencies = {},
): Promise<number> {
    const output = dependencies.output ?? writeCliOutput;
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        output(EXTENSIONS_HELP);
        return args.length === 0 ? 1 : 0;
    }
    const options = parseExtensionOptions(args);
    const interactive =
        dependencies.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
    if (!options.planOnly && !interactive)
        throw new Error(
            "非交互扩展操作必须使用 --plan-only；安装和激活请通过 control 命令逐步确认。",
        );
    const client = (dependencies.client ?? createLocalControlClient)(options.workspace);
    if (options.action === "install") {
        await runControlInstallation(client, dependencies.prompt ?? createControlTerminalPrompt());
        return 0;
    }
    const catalog = await client.installationCatalog();
    const target = removeFromSelection(catalog.selection, options.removal);
    const plan = await client.planInstallation(target, catalog.activeGenerationId);
    if (!sameSelection(plan.removed, options.removal))
        throw new Error("管理服务返回的移除计划与请求不一致，未执行安装");
    if (options.planOnly) {
        output(JSON.stringify(plan));
        return 0;
    }
    await confirmControlInstallation(
        client,
        dependencies.prompt ?? createControlTerminalPrompt(),
        plan,
    );
    return 0;
}

function parseExtensionOptions(args: string[]): ExtensionCommandOptions {
    const action = args[0];
    if (action !== "install" && action !== "remove")
        throw new Error("extensions 子命令应为 install 或 remove；请查看 --help");
    let workspace = process.env.ONEBOTS_WORKSPACE ?? process.cwd();
    let planOnly = false;
    const removal: ControlExtensionSelection = {
        adapters: [],
        protocols: [],
        applications: [],
    };
    const target = new Map([
        ["--adapter", removal.adapters],
        ["--protocol", removal.protocols],
        ["--framework", removal.applications],
    ]);
    for (let index = 1; index < args.length; index++) {
        const argument = args[index];
        if (argument === "--plan-only") {
            if (planOnly) throw new Error("extensions 参数重复");
            planOnly = true;
            continue;
        }
        if (argument === "--data-dir" || argument.startsWith("--data-dir=")) {
            const value = argument === "--data-dir" ? args[++index] : argument.slice(11);
            if (!value || value.startsWith("-") || /[\u0000-\u001f\u007f]/.test(value))
                throw new Error("--data-dir 需要有效工作区目录");
            workspace = value;
            continue;
        }
        const names = target.get(argument);
        if (!names) throw new Error("extensions 参数无效；请查看 --help");
        const value = args[++index];
        if (!value || value.startsWith("-")) throw new Error(`${argument} 需要扩展名称`);
        for (const name of value.split(",").map(item => item.trim())) {
            if (!/^[a-z][a-z0-9-]{0,127}$/.test(name) || names.includes(name))
                throw new Error(`${argument} 包含无效或重复名称`);
            names.push(name);
        }
    }
    if (action === "install" && (planOnly || extensionCount(removal) > 0))
        throw new Error("extensions install 只接受 --data-dir；扩展集合由交互向导选择");
    if (action === "remove" && extensionCount(removal) === 0)
        throw new Error("extensions remove 至少需要一个 --adapter、--protocol 或 --framework");
    return { action, workspace: path.resolve(workspace), planOnly, removal };
}

function extensionCount(value: ControlExtensionSelection): number {
    return value.adapters.length + value.protocols.length + value.applications.length;
}

function removeFromSelection(
    current: ControlExtensionSelection,
    removal: ControlExtensionSelection,
): ControlExtensionSelection {
    const target = {} as ControlExtensionSelection;
    for (const type of ["adapters", "protocols", "applications"] as const) {
        const missing = removal[type].find(name => !current[type].includes(name));
        if (missing) throw new Error(`待移除扩展 ${missing} 不在当前活动运行版本中`);
        target[type] = current[type].filter(name => !removal[type].includes(name));
    }
    return target;
}

function sameSelection(left: ControlExtensionSelection, right: ControlExtensionSelection): boolean {
    return (["adapters", "protocols", "applications"] as const).every(
        type =>
            left[type].length === right[type].length &&
            left[type].every(name => right[type].includes(name)),
    );
}
