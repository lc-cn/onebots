/** OneBots v2 单层命令行入口。 */
import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import yaml from "js-yaml";
import { ServiceController, type ServiceScope, type ServiceSpec } from "./service-manager.js";

const packageVersion = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

interface RuntimeCliOptions {
    config: string;
    register: string[];
    protocol: string[];
}

type CommandOptions = Partial<RuntimeCliOptions> & { system?: boolean };

function collect(value: string, previous: string[]): string[] {
    return [...(previous || []), value];
}

function addRuntimeOptions(command: Command, defaults = false): Command {
    command.option("-c, --config <path>", "配置文件路径", defaults ? "config.yaml" : undefined);
    command.option("-r, --register <adapter>", "注册适配器（可多次）", collect, defaults ? [] : undefined);
    command.option("-p, --protocol <protocol>", "注册协议（可多次）", collect, defaults ? [] : undefined);
    return command;
}

function normalizedOptions(program: Command, command?: Command): RuntimeCliOptions {
    const root = program.opts<RuntimeCliOptions>();
    const local = command?.opts<CommandOptions>() ?? {};
    return {
        config: local.config ?? root.config ?? "config.yaml",
        register: [...(root.register ?? []), ...(local.register ?? [])],
        protocol: [...(root.protocol ?? []), ...(local.protocol ?? [])],
    };
}

function scopeFor(command: Command): ServiceScope {
    return command.opts<{ system?: boolean }>().system ? "system" : "user";
}

function configPathForServiceCommand(program: Command, command: Command): string {
    const options = normalizedOptions(program, command);
    const explicitlyConfigured = program.getOptionValueSource("config") === "cli" || command.getOptionValueSource("config") === "cli";
    if (!explicitlyConfigured) {
        const installed = new ServiceController(scopeFor(command)).readSpec();
        if (installed) return installed.configPath;
    }
    return path.resolve(options.config);
}

function serviceCommand(program: Command, name: string, description: string, action: (controller: ServiceController, command: Command) => Promise<void> | void): Command {
    const command = program.command(name).description(description).option("--system", "操作系统级服务");
    command.action(async () => action(new ServiceController(scopeFor(command)), command));
    return command;
}

export function createCli(): Command {
    const program = addRuntimeOptions(new Command(), true)
        .name("onebots")
        .description("OneBots - 平台 Bot 与框架协议的轻量桥接服务")
        .version(packageVersion)
        .allowExcessArguments(true);

    const run = addRuntimeOptions(program.command("run").description("前台运行 OneBots 桥接服务"));
    run.action(async () => {
        const options = normalizedOptions(program, run);
        const { runBridge } = await import("./runtime.js");
        await runBridge({
            configPath: path.resolve(options.config),
            adapters: options.register,
            protocols: options.protocol,
        });
    });

    const install = addRuntimeOptions(program.command("install").description("安装 OneBots 守护服务"))
        .option("--system", "安装系统级服务");
    install.action(async () => {
        const options = normalizedOptions(program, install);
        const configPath = path.resolve(options.config);
        if (!fs.existsSync(configPath)) throw new CliError(`配置文件不存在: ${configPath}`, 2);
        const missing = findMissingPlugins(options.register, options.protocol, process.cwd());
        if (missing.length) throw new CliError(`插件未安装: ${missing.join(", ")}`, 2);
        const spec: ServiceSpec = {
            scope: scopeFor(install),
            configPath,
            adapters: options.register,
            protocols: options.protocol,
            nodePath: process.execPath,
            binPath: path.resolve(process.argv[1]),
            workingDirectory: process.cwd(),
        };
        await new ServiceController(spec.scope).install(spec);
        console.log(`已安装${spec.scope === "system" ? "系统级" : "用户级"} OneBots 服务（未立即启动）`);
        console.log(`启动: onebots start${spec.scope === "system" ? " --system" : ""}`);
    });

    serviceCommand(program, "start", "启动已安装的 OneBots 服务", async controller => {
        await controller.start();
        console.log("OneBots 服务已启动");
    });
    serviceCommand(program, "stop", "停止 OneBots 服务", async controller => {
        await controller.stop();
        console.log("OneBots 服务已停止");
    });
    serviceCommand(program, "restart", "重启 OneBots 服务", async controller => {
        await controller.restart();
        console.log("OneBots 服务已重启");
    });
    serviceCommand(program, "status", "查看 OneBots 服务状态", controller => {
        const status = controller.status();
        console.log(status.installed ? (status.running ? "运行中" : "已安装，未运行") : "未安装");
        if (status.detail) console.log(status.detail);
        if (!status.installed) process.exitCode = 2;
    });
    const logs = serviceCommand(program, "logs", "查看 OneBots 服务日志", async (controller, command) => {
        const options = command.opts<{ follow?: boolean; lines?: string }>();
        const output = await controller.logs({ follow: options.follow, lines: Number(options.lines ?? 100) });
        if (output) console.log(output);
    });
    logs.option("-f, --follow", "持续跟随日志").option("-n, --lines <n>", "显示最近行数", "100");
    serviceCommand(program, "uninstall", "卸载 OneBots 服务（保留用户数据）", async controller => {
        await controller.uninstall();
        console.log("OneBots 服务已卸载，配置和数据已保留");
    });

    const setup = addRuntimeOptions(program.command("setup").description("引导创建或更新 OneBots 配置"))
        .option("--force", "备份后覆盖已有配置");
    setup.action(async () => {
        const { runSetup } = await import("./setup.js");
        const options = normalizedOptions(program, setup);
        await runSetup(path.resolve(options.config), { force: setup.opts().force, adapters: options.register, protocols: options.protocol });
    });

    const ui = addRuntimeOptions(program.command("ui").description("打开 OneBots 终端运维面板"))
        .option("--system", "查看系统级服务")
        .option("--web", "直接打开 Web 管理端");
    ui.action(async () => {
        const { runUi } = await import("./ui.js");
        await runUi({ configPath: configPathForServiceCommand(program, ui), scope: scopeFor(ui), webOnly: Boolean(ui.opts().web) });
    });

    const doctor = addRuntimeOptions(program.command("doctor").description("诊断 OneBots 配置与服务"))
        .option("--system", "检查系统级服务")
        .option("--fix", "修复安全且无破坏性的问题")
        .option("--json", "输出 JSON");
    doctor.action(async () => {
        const options = normalizedOptions(program, doctor);
        const { runDoctor, printDoctorReport } = await import("./doctor.js");
        const report = await runDoctor({
            configPath: configPathForServiceCommand(program, doctor), adapters: options.register, protocols: options.protocol,
            scope: scopeFor(doctor), fix: Boolean(doctor.opts().fix),
        });
        printDoctorReport(report, Boolean(doctor.opts().json));
        if (!report.ok) process.exitCode = 1;
    });

    const update = addRuntimeOptions(program.command("update").description("检查并更新 OneBots 与已用插件"))
        .option("--system", "更新系统级服务定义")
        .option("--check", "仅检查可用更新")
        .option("--yes", "非交互确认更新");
    update.action(async () => {
        const options = normalizedOptions(program, update);
        const { runUpdate } = await import("./updater.js");
        await runUpdate({ adapters: options.register, protocols: options.protocol, scope: scopeFor(update), check: Boolean(update.opts().check), yes: Boolean(update.opts().yes) });
    });

    registerConfigCommands(program);
    registerSendCommand(program);

    program.action(async () => {
        if (program.args.length) throw new CliError(`未知命令: ${program.args[0]}`, 2);
        const options = normalizedOptions(program);
        const { runBridge } = await import("./runtime.js");
        await runBridge({ configPath: path.resolve(options.config), adapters: options.register, protocols: options.protocol });
    });
    return program;
}

function findMissingPlugins(adapters: string[], protocols: string[], cwd: string): string[] {
    const require = createRequire(path.join(cwd, "package.json"));
    const groups = [
        ...adapters.map(name => [`@onebots/adapter-${name}`, `onebots-adapter-${name}`, name]),
        ...protocols.map(name => [`@onebots/protocol-${name}`, `onebots-protocol-${name}`, name]),
    ];
    return groups.filter(candidates => !candidates.some(candidate => {
        try { require.resolve(candidate); return true; } catch { return false; }
    })).map(candidates => candidates[0]);
}

function registerConfigCommands(program: Command): void {
    const config = addRuntimeOptions(program.command("config").description("查询或修改配置"));
    config.command("get <key>").action((key: string) => {
        const file = path.resolve(normalizedOptions(program, config).config);
        const value = key.split(".").reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], readConfig(file));
        console.log(value === undefined ? "" : String(value));
    });
    config.command("set <key> <value>").action((key: string, value: string) => {
        const file = path.resolve(normalizedOptions(program, config).config);
        const data = readConfig(file);
        const keys = key.split(".");
        let current = data;
        for (const part of keys.slice(0, -1)) {
            if (!current[part] || typeof current[part] !== "object") current[part] = {};
            current = current[part] as Record<string, unknown>;
        }
        const numeric = Number(value);
        current[keys.at(-1)!] = value === "true" ? true : value === "false" ? false : Number.isNaN(numeric) ? value : numeric;
        backupAndWriteConfig(file, data);
        console.log(`已设置 ${key}`);
    });
    config.command("list").action(() => console.log(yaml.dump(readConfig(path.resolve(normalizedOptions(program, config).config)))));
}

function readConfig(file: string): Record<string, unknown> {
    if (!fs.existsSync(file)) throw new CliError(`配置文件不存在: ${file}`, 2);
    return (yaml.load(fs.readFileSync(file, "utf8")) as Record<string, unknown>) || {};
}

function backupAndWriteConfig(file: string, data: Record<string, unknown>): void {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, yaml.dump(data), "utf8");
    fs.renameSync(temporary, file);
}

function registerSendCommand(program: Command): void {
    const send = addRuntimeOptions(program.command("send <target_id> <message>").description("通过运行中的网关发送消息"))
        .requiredOption("--target_type <type>", "private | group | channel")
        .requiredOption("--channel <channel>", "发信 bot，格式 platform.account_id")
        .option("--url <baseUrl>", "网关 base URL");
    send.action(async (targetId: string, message: string) => {
        const options = normalizedOptions(program, send);
        const local = send.opts<{ target_type: string; channel: string; url?: string }>();
        const config = readConfig(path.resolve(options.config));
        const baseUrl = local.url || `http://127.0.0.1:${config.port ?? 6727}${config.path ?? ""}`;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (config.access_token) headers.Authorization = `Bearer ${config.access_token}`;
        else if (config.username && config.password) headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/send`, {
            method: "POST", headers,
            body: JSON.stringify({ channel: local.channel, target_id: targetId, target_type: local.target_type, message }),
        });
        const text = await response.text();
        if (!response.ok) throw new CliError(`发送失败 (${response.status}): ${text}`, 2);
        console.log(text || "发送成功");
    });
}

export class CliError extends Error {
    constructor(message: string, public readonly exitCode = 1) { super(message); }
}

export async function runCli(argv = process.argv): Promise<void> {
    try {
        await createCli().parseAsync(argv);
    } catch (error) {
        const code = error instanceof CliError ? error.exitCode : 1;
        console.error(`[onebots] ${(error as Error).message}`);
        process.exitCode = code;
    }
}
