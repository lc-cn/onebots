/** OneBots 单实例桥接服务的跨平台控制器。 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import {
    LAUNCHD_LABEL,
    SERVICE_NAME,
    renderLaunchdPlist,
    renderSystemdUnit,
    renderWindowsCommand,
    renderWindowsScriptOptions,
    renderWindowsTaskXml,
    type ServiceCommandOptions,
    type ServiceScope,
    type ServiceSpec,
    type ServiceStatus,
} from "./service-definition.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";

export * from "./service-definition.js";
export type { ServiceHost } from "./service-host.js";
const WINDOWS_TASK_NAME = "OneBots Gateway";

function getPaths(scope: ServiceScope, host: ServiceHost) {
    if (host.platform === "linux") {
        const stateDir =
            scope === "system"
                ? "/var/lib/onebots"
                : path.join(
                      host.env.XDG_STATE_HOME || path.join(host.homedir, ".local", "state"),
                      "onebots",
                  );
        const definition =
            scope === "system"
                ? path.join("/etc/systemd/system", `${SERVICE_NAME}.service`)
                : path.join(
                      host.env.XDG_CONFIG_HOME || path.join(host.homedir, ".config"),
                      "systemd",
                      "user",
                      `${SERVICE_NAME}.service`,
                  );
        return { stateDir, definition, metadata: path.join(stateDir, "service.json") };
    }
    if (host.platform === "darwin") {
        const base =
            scope === "system"
                ? "/Library/Application Support/OneBots"
                : path.join(host.homedir, "Library", "Application Support", "OneBots");
        const definition =
            scope === "system"
                ? path.join("/Library/LaunchDaemons", `${LAUNCHD_LABEL}.plist`)
                : path.join(host.homedir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
        return { stateDir: base, definition, metadata: path.join(base, "service.json") };
    }
    const base =
        scope === "system"
            ? path.join(host.env.ProgramData || "C:\\ProgramData", "OneBots")
            : path.join(
                  host.env.LOCALAPPDATA || path.join(host.homedir, "AppData", "Local"),
                  "OneBots",
              );
    return {
        stateDir: base,
        definition: path.join(base, "onebots-service.xml"),
        metadata: path.join(base, "service.json"),
    };
}

function ensureSystemPermission(scope: ServiceScope, host: ServiceHost): void {
    if (scope !== "system") return;
    if (host.platform === "win32") {
        if (host.isElevated !== false) return;
        const argumentsList = process.argv
            .slice(1)
            .map(value => `'${value.replace(/'/g, "''")}'`)
            .join(",");
        throw new Error(
            `系统级服务需要管理员权限。请执行: Start-Process -Verb RunAs -FilePath '${process.execPath.replace(/'/g, "''")}' -ArgumentList @(${argumentsList})`,
        );
    }
    if (host.uid === 0) return;
    const command = [process.execPath, ...process.argv.slice(1)]
        .map(value => `'${value.replace(/'/g, `'"'"'`)}'`)
        .join(" ");
    throw new Error(`系统级服务需要管理员权限。请执行: sudo ${command}`);
}

function writePrivateJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600,
    });
    fs.renameSync(temporary, file);
}

function writeServiceFile(file: string, content: string, encoding: BufferEncoding = "utf8"): void {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporary, content, { encoding, mode: 0o644 });
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

function renderWindowsRunner(spec: ServiceSpec, stateDirectory: string): string {
    return `@echo off\r\ncd /d "${spec.workingDirectory.replace(/"/g, '""')}"\r\n${renderWindowsCommand(spec)} >> "${path.join(stateDirectory, "onebots.log")}" 2>&1\r\n`;
}

interface NodeWindowsService {
    once(event: string, listener: (...args: unknown[]) => void): void;
    install(): void;
    uninstall(): void;
    start(): void;
    stop(): void;
}

function waitForNodeWindows(
    service: NodeWindowsService,
    action: "install" | "uninstall" | "start" | "stop",
): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Windows 服务${action}超时`)), 30_000);
        const done = () => {
            clearTimeout(timeout);
            resolve();
        };
        service.once(action, done);
        service.once(
            action === "install"
                ? "alreadyinstalled"
                : action === "uninstall"
                  ? "alreadyuninstalled"
                  : `already${action}ed`,
            done,
        );
        service.once("error", (error: unknown) => {
            clearTimeout(timeout);
            reject(error instanceof Error ? error : new Error(String(error)));
        });
        service[action]();
    });
}

export class ServiceController {
    constructor(
        private readonly scope: ServiceScope = "user",
        private readonly host: ServiceHost = createDefaultServiceHost(),
    ) {}

    paths() {
        return getPaths(this.scope, this.host);
    }

    readSpec(): ServiceSpec | null {
        const { metadata } = this.paths();
        if (!fs.existsSync(metadata)) return null;
        const parsed: unknown = JSON.parse(fs.readFileSync(metadata, "utf8"));
        if (!isServiceSpec(parsed)) throw new Error(`服务元数据无效: ${metadata}`);
        return parsed;
    }

    /** 检查已写入的平台定义是否与元数据一致。 */
    definitionIsCurrent(spec: ServiceSpec): boolean {
        const paths = this.paths();
        if (!fs.existsSync(paths.definition)) return false;
        if (this.host.platform === "win32" && this.scope === "user") {
            const runnerPath = path.join(paths.stateDir, "onebots-runner.cmd");
            return (
                fs.existsSync(runnerPath) &&
                fs.readFileSync(paths.definition, "utf16le") === renderWindowsTaskXml(runnerPath) &&
                fs.readFileSync(runnerPath, "utf8") === renderWindowsRunner(spec, paths.stateDir)
            );
        }
        if (this.host.platform === "linux")
            return fs.readFileSync(paths.definition, "utf8") === renderSystemdUnit(spec);
        if (this.host.platform === "darwin") {
            return (
                fs.readFileSync(paths.definition, "utf8") ===
                renderLaunchdPlist(
                    spec,
                    path.join(paths.stateDir, "onebots.log"),
                    path.join(paths.stateDir, "onebots-error.log"),
                )
            );
        }
        return true;
    }

    async install(spec: ServiceSpec): Promise<void> {
        ensureSystemPermission(this.scope, this.host);
        const normalized: ServiceSpec = { ...spec, scope: this.scope };
        const paths = this.paths();
        fs.mkdirSync(paths.stateDir, { recursive: true });

        if (this.host.platform === "linux") {
            fs.mkdirSync(path.dirname(paths.definition), { recursive: true });
            writeServiceFile(paths.definition, renderSystemdUnit(normalized));
            const base = this.scope === "user" ? ["--user"] : [];
            this.host.exec("systemctl", [...base, "daemon-reload"], { inherit: true });
            this.host.exec("systemctl", [...base, "enable", SERVICE_NAME], { inherit: true });
        } else if (this.host.platform === "darwin") {
            fs.mkdirSync(path.dirname(paths.definition), { recursive: true });
            writeServiceFile(
                paths.definition,
                renderLaunchdPlist(
                    normalized,
                    path.join(paths.stateDir, "onebots.log"),
                    path.join(paths.stateDir, "onebots-error.log"),
                ),
            );
        } else if (this.host.platform === "win32" && this.scope === "user") {
            const runnerPath = path.join(paths.stateDir, "onebots-runner.cmd");
            writeServiceFile(runnerPath, renderWindowsRunner(normalized, paths.stateDir));
            writeServiceFile(paths.definition, renderWindowsTaskXml(runnerPath), "utf16le");
            this.host.exec(
                "schtasks.exe",
                ["/Create", "/F", "/TN", WINDOWS_TASK_NAME, "/XML", paths.definition],
                { inherit: true },
            );
        } else if (this.host.platform === "win32") {
            const service = createNodeWindowsService(normalized, paths.stateDir);
            if (this.readSpec()) await waitForNodeWindows(service, "uninstall");
            await waitForNodeWindows(service, "install");
        } else {
            throw new Error(`不支持的操作系统: ${this.host.platform}`);
        }
        writePrivateJson(paths.metadata, normalized);
    }

    async start(): Promise<void> {
        ensureSystemPermission(this.scope, this.host);
        this.requireInstalled();
        if (this.host.platform === "linux") {
            this.host.exec(
                "systemctl",
                [...(this.scope === "user" ? ["--user"] : []), "start", SERVICE_NAME],
                { inherit: true },
            );
        } else if (this.host.platform === "darwin") {
            const domain = this.launchdDomain();
            this.host.exec("launchctl", ["bootstrap", domain, this.paths().definition], {
                ignoreError: true,
            });
            this.host.exec("launchctl", ["kickstart", "-k", `${domain}/${LAUNCHD_LABEL}`], {
                inherit: true,
            });
        } else if (this.scope === "user") {
            this.host.exec("schtasks.exe", ["/Run", "/TN", WINDOWS_TASK_NAME], { inherit: true });
        } else {
            this.host.exec("sc.exe", ["start", SERVICE_NAME], { inherit: true });
        }
    }

    async stop(ignoreMissing = false): Promise<void> {
        ensureSystemPermission(this.scope, this.host);
        if (!this.readSpec()) {
            if (ignoreMissing) return;
            this.requireInstalled();
        }
        if (this.host.platform === "linux") {
            this.host.exec(
                "systemctl",
                [...(this.scope === "user" ? ["--user"] : []), "stop", SERVICE_NAME],
                { inherit: true, ignoreError: ignoreMissing },
            );
        } else if (this.host.platform === "darwin") {
            const target = `${this.launchdDomain()}/${LAUNCHD_LABEL}`;
            this.host.exec("launchctl", ["bootout", target], {
                inherit: true,
                ignoreError: ignoreMissing,
            });
        } else if (this.scope === "user") {
            this.host.exec("schtasks.exe", ["/End", "/TN", WINDOWS_TASK_NAME], {
                inherit: true,
                ignoreError: ignoreMissing,
            });
        } else {
            this.host.exec("sc.exe", ["stop", SERVICE_NAME], {
                inherit: true,
                ignoreError: ignoreMissing,
            });
        }
    }

    async restart(): Promise<void> {
        await this.stop();
        await this.start();
    }

    status(spec: ServiceSpec | null = this.readSpec()): ServiceStatus {
        if (!spec)
            return { installed: false, running: false, scope: this.scope, detail: "服务未安装" };
        try {
            let detail = "";
            if (this.host.platform === "linux") {
                detail = this.host
                    .exec("systemctl", [
                        ...(this.scope === "user" ? ["--user"] : []),
                        "is-active",
                        SERVICE_NAME,
                    ])
                    .trim();
                return { installed: true, running: detail === "active", scope: this.scope, detail };
            }
            if (this.host.platform === "darwin") {
                detail = this.host
                    .exec("launchctl", ["print", `${this.launchdDomain()}/${LAUNCHD_LABEL}`])
                    .trim();
                return {
                    installed: true,
                    running: /\bstate\s*=\s*running\b/i.test(detail),
                    scope: this.scope,
                    detail,
                };
            }
            if (this.scope === "user") {
                detail = this.host
                    .exec("schtasks.exe", ["/Query", "/TN", WINDOWS_TASK_NAME, "/FO", "LIST"])
                    .trim();
                return {
                    installed: true,
                    running: /Running|正在运行/i.test(detail),
                    scope: this.scope,
                    detail,
                };
            }
            detail = this.host.exec("sc.exe", ["query", SERVICE_NAME]).trim();
            return { installed: true, running: /RUNNING/.test(detail), scope: this.scope, detail };
        } catch (error) {
            return {
                installed: true,
                running: false,
                scope: this.scope,
                detail: (error as Error).message,
            };
        }
    }

    async logs(options: ServiceCommandOptions = {}): Promise<string> {
        this.requireInstalled();
        const lines = Math.max(1, options.lines ?? 100);
        if (this.host.platform === "linux") {
            const args = [
                ...(this.scope === "user" ? ["--user"] : []),
                "-u",
                SERVICE_NAME,
                "-n",
                String(lines),
                "--no-pager",
                ...(options.follow ? ["-f"] : []),
            ];
            if (options.follow) {
                const code = await this.host.spawn("journalctl", args);
                if (code !== 0) throw new Error(`journalctl 退出码: ${code}`);
                return "";
            }
            return this.host.exec("journalctl", args);
        }
        const { stateDir } = this.paths();
        let logFile = path.join(stateDir, "onebots.log");
        if (!fs.existsSync(logFile) && fs.existsSync(stateDir)) {
            const candidates = fs.readdirSync(stateDir).filter(name => name.endsWith(".log"));
            if (candidates.length) logFile = path.join(stateDir, candidates[0]);
        }
        if (!fs.existsSync(logFile)) return "暂无日志";
        if (options.follow) {
            const command = this.host.platform === "win32" ? "powershell.exe" : "tail";
            const args =
                this.host.platform === "win32"
                    ? [
                          "-NoProfile",
                          "-Command",
                          `Get-Content -Wait -Tail ${lines} -LiteralPath '${logFile.replace(/'/g, "''")}'`,
                      ]
                    : ["-n", String(lines), "-f", logFile];
            const code = await this.host.spawn(command, args);
            if (code !== 0) throw new Error(`日志命令退出码: ${code}`);
            return "";
        }
        return tailFile(logFile, lines);
    }

    async uninstall(): Promise<void> {
        ensureSystemPermission(this.scope, this.host);
        const paths = this.paths();
        if (!this.readSpec()) return;
        await this.stop(true);
        if (this.host.platform === "linux") {
            const base = this.scope === "user" ? ["--user"] : [];
            this.host.exec("systemctl", [...base, "disable", SERVICE_NAME], {
                inherit: true,
                ignoreError: true,
            });
            if (fs.existsSync(paths.definition)) fs.unlinkSync(paths.definition);
            this.host.exec("systemctl", [...base, "daemon-reload"], {
                inherit: true,
                ignoreError: true,
            });
        } else if (this.host.platform === "darwin") {
            if (fs.existsSync(paths.definition)) fs.unlinkSync(paths.definition);
        } else if (this.scope === "user") {
            this.host.exec("schtasks.exe", ["/Delete", "/F", "/TN", WINDOWS_TASK_NAME], {
                inherit: true,
                ignoreError: true,
            });
        } else {
            await waitForNodeWindows(
                createNodeWindowsService(this.readSpec()!, paths.stateDir),
                "uninstall",
            );
        }
        if (fs.existsSync(paths.metadata)) fs.unlinkSync(paths.metadata);
    }

    private requireInstalled(): ServiceSpec {
        const spec = this.readSpec();
        if (!spec)
            throw new Error(
                `服务未安装。请先运行 onebots install${this.scope === "system" ? " --system" : ""} -r <adapter> -p <protocol> -c <config>`,
            );
        return spec;
    }

    private launchdDomain(): string {
        return this.scope === "system" ? "system" : `gui/${this.host.uid ?? 0}`;
    }
}

function isServiceSpec(value: unknown): value is ServiceSpec {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return (
        (item.scope === "user" || item.scope === "system") &&
        typeof item.configPath === "string" &&
        Array.isArray(item.adapters) &&
        item.adapters.every(entry => typeof entry === "string") &&
        Array.isArray(item.protocols) &&
        item.protocols.every(entry => typeof entry === "string") &&
        typeof item.nodePath === "string" &&
        typeof item.binPath === "string" &&
        typeof item.workingDirectory === "string"
    );
}

function createNodeWindowsService(spec: ServiceSpec, logPath: string): NodeWindowsService {
    const require = createRequire(import.meta.url);
    try {
        const Service = (
            require("node-windows") as {
                Service: new (options: Record<string, unknown>) => NodeWindowsService;
            }
        ).Service;
        return new Service({
            name: SERVICE_NAME,
            description: "OneBots Bridge Service",
            script: spec.binPath,
            scriptOptions: renderWindowsScriptOptions(spec),
            execPath: spec.nodePath,
            workingDirectory: spec.workingDirectory,
            logpath: logPath,
            wait: 5,
            grow: 0,
            maxRestarts: -1,
        });
    } catch {
        throw new Error("Windows 系统服务需要可选依赖 node-windows，请重新安装 OneBots 后再试。");
    }
}

function tailFile(file: string, lineCount: number): string {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - lineCount - 1)).join("\n");
}
