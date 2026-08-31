import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { createRequire } from "node:module";
import { ServiceController, type ServiceScope } from "./service-manager.js";
import { pluginCandidates, tryLoadRegisteredPlugin } from "./plugin-loader.js";
import { parseRuntimeConfig, validateRuntimeConfig } from "./runtime-config-validator.js";
import { writeCliOutput } from "./cli-output.js";
import { probeDoctorManagement } from "./doctor-management.js";
import {
    inspectNodeRuntime,
    MINIMUM_NODE_MAJOR,
    unsupportedNodeRuntimeMessage,
} from "./runtime-version.js";

export type CheckLevel = "ok" | "warning" | "error";
export interface DoctorCheck {
    name: string;
    level: CheckLevel;
    message: string;
    fixed?: boolean;
}
export interface DoctorReport {
    ok: boolean;
    checks: DoctorCheck[];
}
export interface DoctorOptions {
    configPath: string;
    adapters: string[];
    protocols: string[];
    scope: ServiceScope;
    fix?: boolean;
}

/** 诊断配置、插件、权限、端口、系统服务与健康端点。 */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
    const checks: DoctorCheck[] = [];
    const runtime = inspectNodeRuntime();
    checks.push({
        name: "node",
        level: runtime.supported ? "ok" : "error",
        message: runtime.supported
            ? `Node.js ${process.version}（要求 >=${MINIMUM_NODE_MAJOR}）`
            : unsupportedNodeRuntimeMessage(runtime),
    });

    let config: Record<string, unknown> | null = null;
    if (!fs.existsSync(options.configPath)) {
        checks.push({
            name: "config",
            level: "error",
            message: `配置文件不存在: ${options.configPath}`,
        });
    } else {
        try {
            config = parseRuntimeConfig(fs.readFileSync(options.configPath, "utf8"));
            checks.push({
                name: "config",
                level: "ok",
                message: `配置语法有效: ${options.configPath}`,
            });
        } catch (error) {
            checks.push({
                name: "config",
                level: "error",
                message: `配置无效: ${(error as Error).message}`,
            });
        }
    }

    if (fs.existsSync(options.configPath)) {
        try {
            fs.accessSync(options.configPath, fs.constants.R_OK | fs.constants.W_OK);
            fs.accessSync(path.dirname(options.configPath), fs.constants.W_OK);
            checks.push({
                name: "permissions",
                level: "ok",
                message: "配置文件可读写，配置目录可写",
            });
        } catch (error) {
            checks.push({
                name: "permissions",
                level: "error",
                message: `配置或目录权限不足: ${(error as Error).message}`,
            });
        }
        if (process.platform !== "win32") {
            checks.push(
                inspectSensitiveFilePermissions(
                    options.configPath,
                    "config-mode",
                    "配置文件",
                    options.fix,
                ),
            );
            const backupPath = `${fs.realpathSync(options.configPath)}.bak`;
            if (fs.existsSync(backupPath)) {
                checks.push(
                    inspectSensitiveFilePermissions(
                        backupPath,
                        "config-backup-mode",
                        "配置备份",
                        options.fix,
                    ),
                );
            }
        }
    }

    const dataDir = path.join(path.dirname(options.configPath), "data");
    if (!fs.existsSync(dataDir) && options.fix) {
        fs.mkdirSync(dataDir, { recursive: true });
        checks.push({
            name: "data-dir",
            level: "ok",
            message: `已创建数据目录: ${dataDir}`,
            fixed: true,
        });
    } else {
        checks.push({
            name: "data-dir",
            level: fs.existsSync(dataDir) ? "ok" : "warning",
            message: fs.existsSync(dataDir)
                ? `数据目录可用: ${dataDir}`
                : "数据目录尚未创建（--fix 可修复）",
        });
    }

    const spec = new ServiceController(options.scope).readSpec();
    const adapters = options.adapters.length ? options.adapters : (spec?.adapters ?? []);
    const protocols = options.protocols.length ? options.protocols : (spec?.protocols ?? []);
    const pluginWorkingDirectory = spec?.workingDirectory ?? process.cwd();
    const runtimeRequire = createRequire(path.join(pluginWorkingDirectory, "package.json"));
    let pluginsReady = true;
    for (const [kind, names] of [
        ["adapter", adapters],
        ["protocol", protocols],
    ] as const) {
        for (const name of names) {
            const result = await tryLoadRegisteredPlugin(
                kind,
                name,
                pluginCandidates(kind, name),
                runtimeRequire,
            );
            pluginsReady &&= result.loaded;
            checks.push({
                name: `${kind}:${name}`,
                level: result.loaded ? "ok" : "error",
                message:
                    result.loaded === true
                        ? `已加载 ${name}（${result.inspection.packageName}@${result.inspection.version ?? "未知版本"}）`
                        : result.message,
            });
        }
    }

    if (config && pluginsReady) {
        try {
            validateRuntimeConfig(config);
            checks.push({ name: "runtime-config", level: "ok", message: "适配器与协议配置有效" });
        } catch (error) {
            checks.push({
                name: "runtime-config",
                level: "error",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const controller = new ServiceController(options.scope);
    const status = controller.status();
    checks.push({
        name: "service",
        level: status.installed ? "ok" : "warning",
        message: status.installed
            ? `服务${status.running ? "正在运行" : "已安装但未运行"}`
            : "服务未安装",
    });
    if (spec) {
        const stateDirectory = controller.paths().stateDir;
        try {
            fs.accessSync(stateDirectory, fs.constants.R_OK | fs.constants.W_OK);
            checks.push({
                name: "service-permissions",
                level: "ok",
                message: `服务状态目录可读写: ${stateDirectory}`,
            });
        } catch (error) {
            checks.push({
                name: "service-permissions",
                level: "error",
                message: `服务状态目录权限不足: ${(error as Error).message}`,
            });
        }
        const requestedPluginsDiffer =
            (options.adapters.length > 0 &&
                options.adapters.join("\0") !== spec.adapters.join("\0")) ||
            (options.protocols.length > 0 &&
                options.protocols.join("\0") !== spec.protocols.join("\0"));
        const stale =
            !fs.existsSync(spec.nodePath) ||
            !fs.existsSync(spec.binPath) ||
            !fs.existsSync(spec.configPath) ||
            !fs.existsSync(spec.workingDirectory) ||
            spec.configPath !== options.configPath ||
            spec.scope !== options.scope ||
            requestedPluginsDiffer ||
            !controller.definitionIsCurrent(spec);
        if (stale && options.fix && options.scope === "user") {
            await controller.install({
                ...spec,
                configPath: options.configPath,
                nodePath: process.execPath,
                binPath: path.resolve(process.argv[1]),
            });
            checks.push({
                name: "service-definition",
                level: "ok",
                message: "已重新生成用户级服务定义",
                fixed: true,
            });
        } else {
            checks.push({
                name: "service-definition",
                level: stale ? "error" : "ok",
                message: stale
                    ? `服务定义中的运行路径已失效${options.scope === "system" ? "；请使用管理员权限重新执行 onebots install --system" : "，--fix 可修复"}`
                    : "服务运行路径有效",
            });
        }
    }

    if (config) {
        const port = Number(config.port ?? 6727);
        const base = resolveGatewayBaseUrl(config);
        const portOpen = status.running || (await isPortOpen(port));
        if (portOpen) {
            for (const endpoint of ["health", "ready"] as const) {
                checks.push(await probeDoctorEndpoint(base, endpoint));
            }
            checks.push(...(await probeDoctorManagement(base, config)));
        } else {
            checks.push({ name: "port", level: "ok", message: `端口 ${port} 可用` });
        }
    }
    return { ok: !checks.some(check => check.level === "error"), checks };
}

/** 检查包含凭据的 POSIX 文件权限；组只读可见但不自动破坏部署授权。 */
export function inspectSensitiveFilePermissions(
    filePath: string,
    name: string,
    label: string,
    fix = false,
): DoctorCheck {
    const mode = fs.statSync(filePath).mode & 0o777;
    const formattedMode = formatMode(mode);
    const hasPublicAccess = (mode & 0o007) !== 0;
    const hasGroupMutation = (mode & 0o030) !== 0;
    if (hasPublicAccess || hasGroupMutation) {
        if (fix) {
            fs.chmodSync(filePath, 0o600);
            return {
                name,
                level: "ok",
                message: `已将${label}权限从 ${formattedMode} 收紧为 0600`,
                fixed: true,
            };
        }
        return {
            name,
            level: "error",
            message: `${label}权限 ${formattedMode} 允许其他用户访问或同组用户修改（--fix 可收紧为 0600）`,
        };
    }
    if ((mode & 0o040) !== 0) {
        return {
            name,
            level: "warning",
            message: `${label}权限 ${formattedMode} 允许同组用户读取；请确认这是服务部署所需`,
        };
    }
    return {
        name,
        level: "ok",
        message: `${label}权限 ${formattedMode} 未向组或其他用户开放`,
    };
}

function formatMode(mode: number): string {
    return mode.toString(8).padStart(3, "0");
}

/** 根据运行时配置生成本机管理与可观测端点的根 URL。 */
export function resolveGatewayBaseUrl(config: Record<string, unknown>): string {
    const port = Number(config.port ?? 6727);
    const configuredPath = String(config.path ?? "").trim();
    const suffix = configuredPath ? `/${configuredPath.replace(/^\/+/, "")}` : "";
    return `http://127.0.0.1:${port}${suffix}`.replace(/\/$/, "");
}

type DoctorEndpoint = "health" | "ready";
type DoctorFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** 探测运行中网关的健康端点；非 2xx 必须使 doctor 失败。 */
export async function probeDoctorEndpoint(
    base: string,
    endpoint: DoctorEndpoint,
    fetcher: DoctorFetch = fetch,
): Promise<DoctorCheck> {
    try {
        const response = await fetcher(`${base}/${endpoint}`, {
            signal: AbortSignal.timeout(2_000),
        });
        const body = await response.text();
        const detail = summarizeEndpointBody(endpoint, body);
        const semanticError = response.ok ? validateEndpointBody(endpoint, body) : undefined;
        const configurationPending =
            endpoint === "ready" && response.ok && !semanticError && isConfigurationPending(body);
        return {
            name: endpoint,
            level:
                response.ok && !semanticError ? (configurationPending ? "warning" : "ok") : "error",
            message: `${endpoint}: HTTP ${response.status}${detail}${semanticError ? `；${semanticError}` : ""}`,
        };
    } catch (error) {
        return {
            name: endpoint,
            level: "error",
            message: `${endpoint} 不可达: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

function summarizeEndpointBody(endpoint: DoctorEndpoint, body: string): string {
    if (!body.trim()) return "";
    try {
        const payload = JSON.parse(body) as Record<string, unknown>;
        if (endpoint !== "ready") {
            return typeof payload.status === "string" ? `；状态 ${payload.status}` : "";
        }
        const summary = payload.summary as Record<string, unknown> | undefined;
        const adapters = payload.adapters as
            | Record<
                  string,
                  {
                      online?: unknown;
                      total?: unknown;
                      offline?: unknown;
                      accounts_without_protocols?: unknown;
                      protocols?: { ready?: unknown; total?: unknown; unavailable?: unknown };
                  }
              >
            | undefined;
        const details: string[] = [];
        if (payload.reloading === true) details.push("配置重载中");
        else if (payload.configured === false) details.push("未配置账号");
        if (summary) {
            details.push(
                `账号 ${Number(summary.online_accounts ?? 0)}/${Number(summary.total_accounts ?? 0)} 在线`,
            );
            if (Number(summary.total_protocols ?? 0) > 0) {
                details.push(
                    `协议 ${Number(summary.ready_protocols ?? 0)}/${Number(summary.total_protocols ?? 0)} 就绪`,
                );
            }
        }
        const unavailable = Object.entries(adapters ?? {})
            .filter(([, state]) => Number(state.offline ?? 0) > 0)
            .map(
                ([platform, state]) =>
                    `${platform}(${Number(state.online ?? 0)}/${Number(state.total ?? 0)})`,
            );
        if (unavailable.length > 0) details.push(`未就绪: ${unavailable.join(", ")}`);
        const unavailableProtocols = Object.entries(adapters ?? {})
            .filter(([, state]) => Number(state.protocols?.unavailable ?? 0) > 0)
            .map(
                ([platform, state]) =>
                    `${platform}(${Number(state.protocols?.ready ?? 0)}/${Number(state.protocols?.total ?? 0)})`,
            );
        if (unavailableProtocols.length > 0) {
            details.push(`协议未就绪: ${unavailableProtocols.join(", ")}`);
        }
        const accountsWithoutProtocols = Object.entries(adapters ?? {})
            .filter(([, state]) => Number(state.accounts_without_protocols ?? 0) > 0)
            .map(
                ([platform, state]) =>
                    `${platform}(${Number(state.accounts_without_protocols ?? 0)})`,
            );
        if (accountsWithoutProtocols.length > 0) {
            details.push(`无协议出口: ${accountsWithoutProtocols.join(", ")}`);
        }
        return details.length > 0 ? `；${details.join("；")}` : "";
    } catch {
        const singleLine = body.replace(/\s+/gu, " ").trim();
        return singleLine ? `；响应 ${singleLine.slice(0, 160)}` : "";
    }
}

function isConfigurationPending(body: string): boolean {
    try {
        const payload = JSON.parse(body) as Record<string, unknown>;
        return payload.configured === false && payload.reloading !== true;
    } catch {
        return false;
    }
}

function validateEndpointBody(endpoint: DoctorEndpoint, body: string): string | undefined {
    try {
        const payload = JSON.parse(body) as Record<string, unknown>;
        if (endpoint === "health" && payload.status !== "ok") {
            return "响应未声明 status: ok";
        }
        if (endpoint === "ready" && payload.ready !== true) {
            return "响应未声明 ready: true";
        }
        return undefined;
    } catch {
        return "响应不是有效 JSON";
    }
}

/** 以人类可读或 JSON 格式输出诊断结果。 */
export function printDoctorReport(report: DoctorReport, json = false): void {
    writeCliOutput(formatDoctorReport(report, json));
}

/** 将诊断结果格式化，供 CLI、TUI 和机器输出共享。 */
export function formatDoctorReport(report: DoctorReport, json = false): string {
    if (json) return JSON.stringify(report, null, 2);
    const lines = report.checks.map(check => {
        const mark = check.level === "ok" ? "✓" : check.level === "warning" ? "!" : "✗";
        return `${mark} ${check.name}: ${check.message}${check.fixed ? " [fixed]" : ""}`;
    });
    lines.push(report.ok ? "OneBots 诊断通过" : "OneBots 存在需要处理的问题");
    return lines.join("\n");
}

function isPortOpen(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const socket = net.connect({ host: "127.0.0.1", port });
        const finish = (result: boolean) => {
            socket.destroy();
            resolve(result);
        };
        socket.setTimeout(500);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
    });
}
