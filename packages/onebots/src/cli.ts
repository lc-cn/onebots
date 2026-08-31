/** OneBots CLI 的 Pastel 路由入口与无 TTY 服务运行入口。 */
import * as path from "node:path";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { prepareCliInvocation } from "./cli-invocation.js";
import { CliError } from "./cli/command-application.js";
import { writeCliError } from "./cli-output.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";
import { getRuntimePluginSelection } from "./runtime-plugin-selection.js";

const packageVersion = (createRequire(import.meta.url)("../package.json") as { version: string })
    .version;

/** 启动文件路由 CLI；系统服务的内部入口会绕过 Pastel 和 Ink。 */
export async function runCli(argv = process.argv): Promise<void> {
    try {
        const invocation = prepareCliInvocation(argv);
        if (invocation.kind === "unknown") throw new CliError(`未知命令: ${invocation.command}`, 2);
        if (invocation.kind === "invalid") throw new CliError(invocation.message, 2);
        if (invocation.kind === "service-runtime") {
            const parsedRuntime = parseServiceRuntimeInvocation(invocation.argv);
            const runtime = {
                ...parsedRuntime,
                options: resolveServiceRuntimeOptions(parsedRuntime.options),
            };
            if (runtime.command === "preflight") {
                const { preflightServiceRuntime } = await import("./service-preflight.js");
                await preflightServiceRuntime({
                    ...runtime.options,
                    workingDirectory: process.cwd(),
                });
            } else {
                const { runBridge } = await import("./runtime.js");
                await runBridge(runtime.options);
            }
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

/** 服务定义只保存兼容旧配置的启动快照；一旦配置声明 plugins，始终以配置为准。 */
export function resolveServiceRuntimeOptions(options: {
    configPath: string;
    adapters: string[];
    protocols: string[];
}) {
    if (!fs.existsSync(options.configPath)) return options;
    const source = fs.readFileSync(options.configPath, "utf8");
    const selection = getRuntimePluginSelection(parseRuntimeConfig(source));
    return selection
        ? { ...options, adapters: selection.adapters, protocols: selection.protocols }
        : options;
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

export function parseServiceRuntimeInvocation(argv: string[]) {
    const options = {
        configPath: path.resolve("config.yaml"),
        adapters: [] as string[],
        protocols: [] as string[],
    };
    const args = argv.slice(2);
    const command = args[0] === "preflight" ? "preflight" : "run";
    if (args[0] === "run" || args[0] === "preflight") args.shift();
    for (let index = 0; index < args.length; index++) {
        const token = args[index];
        if (token === "-c" || token === "--config")
            options.configPath = path.resolve(requireValue(args, ++index, token));
        else if (token === "-r" || token === "--register")
            options.adapters.push(requireValue(args, ++index, token));
        else if (token === "-p" || token === "--protocol")
            options.protocols.push(requireValue(args, ++index, token));
        else if (token.startsWith("--config="))
            options.configPath = path.resolve(token.slice("--config=".length));
        else if (token.startsWith("--register="))
            options.adapters.push(token.slice("--register=".length));
        else if (token.startsWith("--protocol="))
            options.protocols.push(token.slice("--protocol=".length));
        else throw new CliError(`无效的服务运行参数: ${token}`, 2);
    }
    return { command, options } as const;
}

function requireValue(args: string[], index: number, option: string): string {
    const value = args[index];
    if (!value) throw new CliError(`${option} 缺少参数`, 2);
    return value;
}
