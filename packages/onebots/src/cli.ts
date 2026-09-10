/** OneBots CLI 的 Pastel 路由入口。 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { prepareCliInvocation } from "./cli-invocation.js";
import { CliError } from "./cli/command-application.js";
import { writeCliError } from "./cli-output.js";

const packageVersion = (createRequire(import.meta.url)("../package.json") as { version: string })
    .version;

/** 启动文件路由 CLI；系统服务的内部入口会绕过 Pastel 和 Ink。 */
export async function runCli(argv = process.argv): Promise<void> {
    try {
        const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
        const { isDirectControlTuiInvocation, runControlTuiCommand } =
            await import("./control/tui-command.js");
        if (isDirectControlTuiInvocation(argv, interactive)) {
            await runControlTuiCommand(
                argv[2] === "setup"
                    ? ["--setup", ...argv.slice(3)]
                    : ["ui", "tui"].includes(argv[2])
                      ? argv.slice(3)
                      : argv.slice(2),
            );
            return;
        }
        if (["serve", "auth", "control"].includes(argv[2])) {
            const { runControlCommand } = await import("./control/command.js");
            if (await runControlCommand(argv)) return;
        }
        const invocation = prepareCliInvocation(
            argv,
            process.stdin.isTTY === true && process.stdout.isTTY === true,
        );
        if (invocation.kind === "unknown") throw new CliError(`未知命令: ${invocation.command}`, 2);
        if (invocation.kind === "invalid") throw new CliError(invocation.message, 2);
        if (invocation.kind === "cli" && invocation.argv[2] === "update") {
            const { runManagerUpdate } = await import("./cli/manager-update.js");
            process.exitCode = await runManagerUpdate(invocation.argv.slice(3));
            return;
        }
        if (invocation.kind === "cli" && invocation.argv[2] === "send") {
            const { runManagerSend } = await import("./cli/manager-send.js");
            process.exitCode = await runManagerSend(invocation.argv.slice(3));
            return;
        }
        if (invocation.kind === "cli" && invocation.argv[2] === "mcp") {
            const { runManagerMcp } = await import("./cli/manager-mcp.js");
            await runManagerMcp(invocation.argv.slice(3));
            return;
        }
        if (invocation.kind === "cli" && invocation.argv[2] === "extensions") {
            const { runManagerExtensions } = await import("./cli/manager-extensions.js");
            process.exitCode = await runManagerExtensions(invocation.argv.slice(3));
            return;
        }
        if (invocation.kind === "cli" && invocation.argv[2] === "run") {
            const { runManagerForeground } = await import("./cli/manager-foreground.js");
            await runManagerForeground(invocation.argv.slice(3));
            return;
        }
        if (invocation.kind === "cli" && ["ui", "tui", "setup"].includes(invocation.argv[2])) {
            await runControlTuiCommand(
                invocation.argv[2] === "setup"
                    ? ["--setup", ...invocation.argv.slice(3)]
                    : invocation.argv.slice(3),
            );
            return;
        }
        if (requiresHeadlessPresentation(invocation.argv)) {
            process.exitCode = await runHeadlessCli(invocation.argv);
            return;
        }
        const { default: Pastel } = await import("pastel");
        const app = new Pastel({
            importMeta: import.meta,
            name: "onebots",
            version: packageVersion,
            description: "OneBots - 平台 Bot 与框架协议的轻量桥接服务",
        });
        await app.run(invocation.argv);
    } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        writeCliError(`[onebots] ${normalized.message}`);
        process.exitCode = normalized instanceof CliError ? normalized.exitCode : 1;
    }
}

function requiresHeadlessPresentation(argv: string[]): boolean {
    return (
        process.stdout.isTTY === true &&
        process.env.ONEBOTS_HEADLESS_CHILD !== "1" &&
        argv[2] === "doctor" &&
        argv.slice(3).includes("--json")
    );
}

function runHeadlessCli(argv: string[]): Promise<number> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [argv[1], ...argv.slice(2)], {
            env: { ...process.env, ONEBOTS_HEADLESS_CHILD: "1" },
            stdio: ["inherit", "pipe", "inherit"],
        });
        child.stdout.pipe(process.stdout);
        child.once("error", reject);
        child.once("exit", code => resolve(code ?? 1));
    });
}
