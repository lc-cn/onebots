import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { createRequire } from "node:module";
import yaml from "js-yaml";
import { ServiceController, type ServiceScope } from "./service-manager.js";

export type CheckLevel = "ok" | "warning" | "error";
export interface DoctorCheck { name: string; level: CheckLevel; message: string; fixed?: boolean }
export interface DoctorReport { ok: boolean; checks: DoctorCheck[] }
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
    const major = Number(process.versions.node.split(".")[0]);
    checks.push({ name: "node", level: major >= 24 ? "ok" : "error", message: `Node.js ${process.version}${major >= 24 ? "" : "，需要 >=24"}` });

    let config: Record<string, unknown> | null = null;
    if (!fs.existsSync(options.configPath)) {
        checks.push({ name: "config", level: "error", message: `配置文件不存在: ${options.configPath}` });
    } else {
        try {
            config = (yaml.load(fs.readFileSync(options.configPath, "utf8")) as Record<string, unknown>) || {};
            const [{ ConfigValidator }, { getAppConfigSchema }] = await Promise.all([import("@onebots/core"), import("./config-schema.js")]);
            ConfigValidator.validate(config, getAppConfigSchema().base);
            checks.push({ name: "config", level: "ok", message: `配置有效: ${options.configPath}` });
        } catch (error) {
            checks.push({ name: "config", level: "error", message: `配置无效: ${(error as Error).message}` });
        }
    }

    if (fs.existsSync(options.configPath)) {
        try {
            fs.accessSync(options.configPath, fs.constants.R_OK | fs.constants.W_OK);
            fs.accessSync(path.dirname(options.configPath), fs.constants.W_OK);
            checks.push({ name: "permissions", level: "ok", message: "配置文件可读写，配置目录可写" });
        } catch (error) {
            checks.push({ name: "permissions", level: "error", message: `配置或目录权限不足: ${(error as Error).message}` });
        }
    }

    const dataDir = path.join(path.dirname(options.configPath), "data");
    if (!fs.existsSync(dataDir) && options.fix) {
        fs.mkdirSync(dataDir, { recursive: true });
        checks.push({ name: "data-dir", level: "ok", message: `已创建数据目录: ${dataDir}`, fixed: true });
    } else {
        checks.push({ name: "data-dir", level: fs.existsSync(dataDir) ? "ok" : "warning", message: fs.existsSync(dataDir) ? `数据目录可用: ${dataDir}` : "数据目录尚未创建（--fix 可修复）" });
    }

    const spec = new ServiceController(options.scope).readSpec();
    const adapters = options.adapters.length ? options.adapters : spec?.adapters ?? [];
    const protocols = options.protocols.length ? options.protocols : spec?.protocols ?? [];
    for (const [kind, names] of [["adapter", adapters], ["protocol", protocols]] as const) {
        for (const name of names) {
            const candidates = kind === "adapter"
                ? [`@onebots/adapter-${name}`, `onebots-adapter-${name}`, name]
                : [`@onebots/protocol-${name}`, `onebots-protocol-${name}`, name];
            const found = canResolve(candidates, path.dirname(options.configPath));
            checks.push({ name: `${kind}:${name}`, level: found ? "ok" : "error", message: found ? `已找到 ${name}` : `未找到 ${candidates[0]}` });
        }
    }

    const controller = new ServiceController(options.scope);
    const status = controller.status();
    checks.push({ name: "service", level: status.installed ? "ok" : "warning", message: status.installed ? `服务${status.running ? "正在运行" : "已安装但未运行"}` : "服务未安装" });
    if (spec) {
        const stateDirectory = controller.paths().stateDir;
        try {
            fs.accessSync(stateDirectory, fs.constants.R_OK | fs.constants.W_OK);
            checks.push({ name: "service-permissions", level: "ok", message: `服务状态目录可读写: ${stateDirectory}` });
        } catch (error) {
            checks.push({ name: "service-permissions", level: "error", message: `服务状态目录权限不足: ${(error as Error).message}` });
        }
        const requestedPluginsDiffer = (options.adapters.length > 0 && options.adapters.join("\0") !== spec.adapters.join("\0"))
            || (options.protocols.length > 0 && options.protocols.join("\0") !== spec.protocols.join("\0"));
        const stale = !fs.existsSync(spec.nodePath)
            || !fs.existsSync(spec.binPath)
            || !fs.existsSync(spec.configPath)
            || !fs.existsSync(spec.workingDirectory)
            || spec.configPath !== options.configPath
            || spec.scope !== options.scope
            || requestedPluginsDiffer
            || !controller.definitionIsCurrent(spec);
        if (stale && options.fix && options.scope === "user") {
            await controller.install({ ...spec, configPath: options.configPath, nodePath: process.execPath, binPath: path.resolve(process.argv[1]) });
            checks.push({ name: "service-definition", level: "ok", message: "已重新生成用户级服务定义", fixed: true });
        } else {
            checks.push({ name: "service-definition", level: stale ? "error" : "ok", message: stale ? `服务定义中的运行路径已失效${options.scope === "system" ? "；请使用管理员权限重新执行 onebots install --system" : "，--fix 可修复"}` : "服务运行路径有效" });
        }
    }

    if (config) {
        const port = Number(config.port ?? 6727);
        const configuredPath = String(config.path ?? "").trim();
        const suffix = configuredPath ? `/${configuredPath.replace(/^\/+/, "")}` : "";
        const base = `http://127.0.0.1:${port}${suffix}`.replace(/\/$/, "");
        if (status.running) {
            for (const endpoint of ["health", "ready"]) {
                try {
                    const response = await fetch(`${base}/${endpoint}`, { signal: AbortSignal.timeout(2000) });
                    checks.push({ name: endpoint, level: response.ok ? "ok" : "warning", message: `${endpoint}: HTTP ${response.status}` });
                } catch (error) {
                    checks.push({ name: endpoint, level: "error", message: `${endpoint} 不可达: ${(error as Error).message}` });
                }
            }
        } else if (await isPortOpen(port)) {
            checks.push({ name: "port", level: "warning", message: `端口 ${port} 已被其他进程占用` });
        } else {
            checks.push({ name: "port", level: "ok", message: `端口 ${port} 可用` });
        }
    }
    return { ok: !checks.some(check => check.level === "error"), checks };
}

/** 以人类可读或 JSON 格式输出诊断结果。 */
export function printDoctorReport(report: DoctorReport, json = false): void {
    console.log(formatDoctorReport(report, json));
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

function canResolve(candidates: string[], cwd: string): boolean {
    const require = createRequire(path.join(cwd, "package.json"));
    return candidates.some(candidate => { try { require.resolve(candidate); return true; } catch { return false; } });
}

function isPortOpen(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const socket = net.connect({ host: "127.0.0.1", port });
        const finish = (result: boolean) => { socket.destroy(); resolve(result); };
        socket.setTimeout(500);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
    });
}
