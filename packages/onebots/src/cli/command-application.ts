/** OneBots CLI 命令背后的无路由 application module。 */
import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import type { Account, Protocol } from "@onebots/core";
import { ServiceController, type ServiceScope, type ServiceSpec } from "../service-manager.js";
import { preflightServiceRuntime, type ServicePreflightSpec } from "../service-preflight.js";
import type { RuntimeOptions, ScopeOptions } from "./command-options.js";

/** 路由组件可渲染的稳定命令结果。 */
export interface CommandResult {
    output?: string;
    exitCode?: number;
    raw?: boolean;
}

/** 带进程退出码的用户可操作 CLI 错误。 */
export class CliError extends Error {
    constructor(
        message: string,
        public readonly exitCode = 1,
    ) {
        super(message);
    }
}

/** 将公开 CLI 参数转换为 runtime module 所需的绝对路径与插件列表。 */
export function normalizeRuntimeOptions(options: RuntimeOptions) {
    return {
        configPath: path.resolve(options.config ?? "config.yaml"),
        adapters: [...new Set(options.register)],
        protocols: [...new Set(options.protocol)],
    };
}

/** 将 `--system` 标志转换为服务 scope。 */
export function scopeFrom(options: ScopeOptions): ServiceScope {
    return options.system ? "system" : "user";
}

/** 使用与裸 `onebots` 相同的 runtime module 前台运行桥接服务。 */
export async function runForeground(options: RuntimeOptions): Promise<CommandResult> {
    const runtime = normalizeRuntimeOptions(options);
    const { runBridge } = await import("../runtime.js");
    await runBridge(runtime);
    return {};
}

/** 校验运行环境并安装或更新固定的 OneBots 服务定义。 */
export async function installService(
    options: RuntimeOptions & ScopeOptions,
): Promise<CommandResult> {
    const runtime = normalizeRuntimeOptions(options);
    const scope = scopeFrom(options);
    const spec: ServiceSpec = {
        scope,
        configPath: runtime.configPath,
        adapters: runtime.adapters,
        protocols: runtime.protocols,
        nodePath: process.execPath,
        binPath: path.resolve(process.argv[1]),
        workingDirectory: process.cwd(),
    };
    await preflightService(spec, "安装");
    await new ServiceController(scope).install(spec);
    const suffix = scope === "system" ? " --system" : "";
    return {
        output: `已安装${scope === "system" ? "系统级" : "用户级"} OneBots 服务（未立即启动）\n启动: onebots start${suffix}`,
    };
}

/** 启动当前 scope 中已安装的服务。 */
export async function startService(options: ScopeOptions): Promise<CommandResult> {
    const controller = new ServiceController(scopeFrom(options));
    await preflightInstalledService(controller, "启动");
    await controller.start();
    return { output: "OneBots 服务已启动" };
}

/** 停止当前 scope 中已安装的服务。 */
export async function stopService(options: ScopeOptions): Promise<CommandResult> {
    await new ServiceController(scopeFrom(options)).stop();
    return { output: "OneBots 服务已停止" };
}

/** 重启当前 scope 中已安装的服务。 */
export async function restartService(options: ScopeOptions): Promise<CommandResult> {
    const controller = new ServiceController(scopeFrom(options));
    await preflightInstalledService(controller, "重启");
    await controller.restart();
    return { output: "OneBots 服务已重启" };
}

/** 返回当前 scope 的服务状态和适合 CLI 的退出码。 */
export function serviceStatus(options: ScopeOptions): CommandResult {
    const status = new ServiceController(scopeFrom(options)).status();
    const summary = status.installed ? (status.running ? "运行中" : "已安装，未运行") : "未安装";
    return {
        output: status.detail ? `${summary}\n${status.detail}` : summary,
        exitCode: status.installed ? undefined : 2,
    };
}

/** 读取或持续跟随当前 scope 的服务日志。 */
export async function serviceLogs(
    options: ScopeOptions & { follow: boolean; lines: number },
): Promise<CommandResult> {
    const output = await new ServiceController(scopeFrom(options)).logs(options);
    return { output };
}

/** 移除服务定义并保留配置、日志和数据库。 */
export async function uninstallService(options: ScopeOptions): Promise<CommandResult> {
    await new ServiceController(scopeFrom(options)).uninstall();
    return { output: "OneBots 服务已卸载，配置和数据已保留" };
}

/** 运行配置 schema 驱动的 setup 流程。 */
export async function setupConfiguration(
    options: RuntimeOptions & { force: boolean },
): Promise<CommandResult> {
    const runtime = normalizeRuntimeOptions(options);
    const { runSetup } = await import("../setup.js");
    await runSetup(runtime.configPath, {
        force: options.force,
        adapters: runtime.adapters,
        protocols: runtime.protocols,
    });
    return {};
}

/** 优先返回显式配置路径，否则使用已安装服务保存的路径。 */
export function serviceConfigPath(options: RuntimeOptions & ScopeOptions): string {
    if (options.config) return path.resolve(options.config);
    return (
        new ServiceController(scopeFrom(options)).readSpec()?.configPath ??
        path.resolve("config.yaml")
    );
}

/** 执行 doctor 检查并格式化为人类或 JSON 输出。 */
export async function diagnose(
    options: RuntimeOptions & ScopeOptions & { fix: boolean; json: boolean },
): Promise<CommandResult> {
    const runtime = normalizeRuntimeOptions(options);
    const { runDoctor, formatDoctorReport } = await import("../doctor.js");
    const report = await runDoctor({
        configPath: serviceConfigPath(options),
        adapters: runtime.adapters,
        protocols: runtime.protocols,
        scope: scopeFrom(options),
        fix: options.fix,
    });
    return {
        output: formatDoctorReport(report, options.json),
        exitCode: report.ok ? undefined : 1,
        raw: options.json,
    };
}

/** 检查或更新 OneBots 与当前选用的插件。 */
export async function updatePackages(
    options: RuntimeOptions & ScopeOptions & { check: boolean; yes: boolean },
): Promise<CommandResult> {
    const runtime = normalizeRuntimeOptions(options);
    const { runUpdate } = await import("../updater.js");
    await runUpdate({
        adapters: runtime.adapters,
        protocols: runtime.protocols,
        scope: scopeFrom(options),
        check: options.check,
        yes: options.yes,
    });
    return {};
}

/** 读取点分隔路径表示的配置项。 */
export function getConfig(options: RuntimeOptions, key: string): CommandResult {
    const data = readConfig(normalizeRuntimeOptions(options).configPath);
    const value = key.split(".").reduce<unknown>((current, part) => {
        if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
        return current[part as keyof typeof current];
    }, data);
    return { output: value === undefined ? "" : String(value) };
}

/** 写入点分隔路径表示的配置项，并保留备份。 */
export function setConfig(options: RuntimeOptions, key: string, value: string): CommandResult {
    const file = normalizeRuntimeOptions(options).configPath;
    const data = readConfig(file);
    const keys = key.split(".");
    let current = data;
    for (const part of keys.slice(0, -1)) {
        if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part]))
            current[part] = {};
        current = current[part] as Record<string, unknown>;
    }
    const numeric = Number(value);
    current[keys.at(-1)!] =
        value === "true"
            ? true
            : value === "false"
              ? false
              : Number.isNaN(numeric)
                ? value
                : numeric;
    backupAndWriteConfig(file, data);
    return { output: `已设置 ${key}` };
}

/** 以 YAML 返回完整配置。 */
export function listConfig(options: RuntimeOptions): CommandResult {
    return { output: yaml.dump(readConfig(normalizeRuntimeOptions(options).configPath)) };
}

/** 通过运行中网关的 HTTP API 发送消息。 */
export async function sendMessage(
    options: RuntimeOptions & { target_type: string; channel: string; url?: string },
    targetId: string,
    message: string,
): Promise<CommandResult> {
    const config = readConfig(normalizeRuntimeOptions(options).configPath);
    const baseUrl = options.url || `http://127.0.0.1:${config.port ?? 6727}${config.path ?? ""}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.access_token) headers.Authorization = `Bearer ${config.access_token}`;
    else if (config.username && config.password)
        headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            channel: options.channel,
            target_id: targetId,
            target_type: options.target_type,
            message,
        }),
    });
    const text = await response.text();
    if (!response.ok) throw new CliError(`发送失败 (${response.status}): ${text}`, 2);
    return { output: text || "发送成功" };
}

/** 以 stdio 模式运行 MCP 服务，通过 stdin/stdout 进行 JSON-RPC 通信。 */
export async function runMcpStdio(
    options: RuntimeOptions & { account?: string },
): Promise<CommandResult> {
    const runtime = normalizeRuntimeOptions(options);
    const { loadPlugins } = await import("../runtime.js");
    const failures = await loadPlugins(runtime.adapters, runtime.protocols);
    if (failures.length) throw new CliError(`无法加载插件: ${failures.join(", ")}`, 2);

    const { createOnebots } = await import("../app.js");
    const app = createOnebots(runtime.configPath);

    await app.start();

    // 查找目标 account
    let targetAccount: Account | undefined;

    if (options.account) {
        const [platform, accountId] = options.account.split("/");
        if (!platform || !accountId)
            throw new CliError("--account 格式: platform/account_id（如 qq/my-bot）", 2);
        for (const adapter of app.adapters.values()) {
            if (String(adapter.platform) === platform) {
                targetAccount = adapter.getAccount(accountId);
                if (targetAccount) break;
            }
        }
        if (!targetAccount) throw new CliError(`找不到账号 ${options.account}`, 2);
    } else {
        // 没指定 account 时取第一个
        for (const adapter of app.adapters.values()) {
            for (const account of adapter.accounts.values()) {
                targetAccount = account;
                break;
            }
            if (targetAccount) break;
        }
        if (!targetAccount)
            throw new CliError("没有可用的账号，请在配置中添加至少一个适配器账号", 2);
    }

    // 查找该 account 上的 MCP 协议实例
    const mcpProtocol = targetAccount.protocols?.find(
        protocol => protocol.name === "mcp" && protocol.version === "v1",
    );
    if (!mcpProtocol) {
        throw new CliError(
            `账号 ${targetAccount.platform}/${targetAccount.account_id} 未配置 mcp.v1 协议。\n` +
                `请在 config.yaml 对应账号下添加:\n  mcp.v1: {}`,
            2,
        );
    }

    // 动态导入 stdio 传输（协议包作为插件加载，不是编译时依赖）
    const mcpModName = "@onebots/protocol-mcp-v1";
    let startStdioTransport: (options: {
        protocol: Protocol;
        onClose?: () => void | Promise<void>;
    }) => void;
    try {
        const module: unknown = await import(/* webpackIgnore: true */ mcpModName);
        if (!isMcpStdioModule(module)) {
            throw new Error("插件未导出 startStdioTransport");
        }
        startStdioTransport = module.startStdioTransport;
    } catch {
        throw new CliError(
            "无法加载 @onebots/protocol-mcp-v1，请确保已安装:\n  pnpm add @onebots/protocol-mcp-v1",
            2,
        );
    }
    startStdioTransport({
        protocol: mcpProtocol,
        onClose: async () => {
            await app.stop();
        },
    });

    // stdio 模式下不退出，等待输入
    return new Promise(() => {});
}

function isMcpStdioModule(value: unknown): value is {
    startStdioTransport(options: {
        protocol: Protocol;
        onClose?: () => void | Promise<void>;
    }): void;
} {
    return (
        typeof value === "object" &&
        value !== null &&
        "startStdioTransport" in value &&
        typeof value.startStdioTransport === "function"
    );
}

async function preflightInstalledService(
    controller: ServiceController,
    action: "启动" | "重启",
): Promise<void> {
    const spec = controller.readSpec();
    if (!spec) throw new CliError("OneBots 服务尚未安装", 2);
    await preflightService(spec, action);
}

async function preflightService(spec: ServicePreflightSpec, action: string): Promise<void> {
    try {
        await preflightServiceRuntime(spec);
    } catch (error) {
        throw new CliError(
            `服务${action}预检失败：${error instanceof Error ? error.message : String(error)}`,
            2,
        );
    }
}

function readConfig(file: string): Record<string, unknown> {
    if (!fs.existsSync(file)) throw new CliError(`配置文件不存在: ${file}`, 2);
    const loaded: unknown = yaml.load(fs.readFileSync(file, "utf8"));
    if (loaded === undefined || loaded === null) return {};
    if (typeof loaded !== "object" || Array.isArray(loaded))
        throw new CliError(`配置文件根节点必须是对象: ${file}`, 2);
    return loaded as Record<string, unknown>;
}

function backupAndWriteConfig(file: string, data: Record<string, unknown>): void {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, yaml.dump(data), "utf8");
    fs.renameSync(temporary, file);
}
