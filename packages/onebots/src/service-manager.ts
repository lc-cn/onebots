/** OneBots 单实例桥接服务的跨平台控制器。 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import {
    LAUNCHD_LABEL,
    SERVICE_NAME,
    renderLaunchdPlist,
    renderSystemdUnit,
    type ServiceCommandOptions,
    type ServiceScope,
    type ServiceSpec,
    type ServiceStatus,
} from "./service-definition.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import { runServiceInstallTransaction } from "./service-install-transaction.js";
import { verifyServiceStopped } from "./service-offline-verification.js";
import { getServiceFiles, writePrivateJson, writeServiceFile } from "./service-files.js";
import {
    WINDOWS_SYSTEM_SERVICE_ID,
    buildWindowsSystemServiceOptions,
    getWindowsSystemServiceFiles,
    renderWindowsSystemRunner,
    type WindowsSystemServiceOptions,
    validateWindowsSystemServiceDefinition,
} from "./windows-system-service-definition.js";
import {
    getWindowsUserServiceFiles,
    renderWindowsUserRunner,
    renderWindowsUserTaskXml,
} from "./windows-user-service-definition.js";

export * from "./service-definition.js";
export type { ServiceHost } from "./service-host.js";
const WINDOWS_TASK_NAME = "OneBots Gateway";

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

interface NodeWindowsService {
    directory(root?: string): string;
    readonly exists: boolean;
    once(event: string, listener: (...args: unknown[]) => void): void;
    install(): void;
    uninstall(): void;
    start(): void;
    stop(): void;
}

export interface ServiceUninstallOptions {
    /** 测试或嵌入场景可替换有界停止验证。 */
    verifyStopped?: () => Promise<void>;
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
        return getServiceFiles(this.scope, this.host);
    }

    /** 返回承载真实启动契约的平台定义；Windows 系统服务由 node-windows 写在入口旁。 */
    definitionPath(spec: ServiceSpec): string {
        if (this.host.platform === "win32" && this.scope === "system") {
            return getWindowsSystemServiceFiles(spec, this.paths().stateDir).definition;
        }
        return this.paths().definition;
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
        const definition = this.definitionPath(spec);
        if (!fs.existsSync(definition)) return false;
        if (this.host.platform === "win32" && this.scope === "user") {
            const files = getWindowsUserServiceFiles(paths.stateDir);
            return (
                fs.existsSync(files.runner) &&
                fs.readFileSync(definition, "utf16le") ===
                    renderWindowsUserTaskXml(spec.nodePath, files.runner) &&
                fs.readFileSync(files.runner, "utf8") === renderWindowsUserRunner(spec, files.log)
            );
        }
        if (this.host.platform === "win32") {
            const files = getWindowsSystemServiceFiles(spec, paths.stateDir);
            return (
                fs.existsSync(files.executable) &&
                fs.existsSync(files.runner) &&
                fs.readFileSync(files.runner, "utf8") === renderWindowsSystemRunner(spec) &&
                validateWindowsSystemServiceDefinition(
                    fs.readFileSync(definition, "utf8"),
                    spec,
                    paths.stateDir,
                    resolveNodeWindowsWrapper(),
                )
            );
        }
        if (this.host.platform === "linux")
            return fs.readFileSync(definition, "utf8") === renderSystemdUnit(spec);
        if (this.host.platform === "darwin") {
            return (
                fs.readFileSync(definition, "utf8") ===
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
        const previous = this.readValidSpecForRollback();

        await runServiceInstallTransaction({
            target: normalized,
            previous,
            apply: (target, replaced) => this.applyPlatformDefinition(target, replaced),
            remove: target => this.removePlatformDefinition(target),
            verify: target => this.definitionIsCurrent(target),
            commit: target => writePrivateJson(paths.metadata, target),
            definitionPath: target => this.definitionPath(target),
        });
    }

    private async applyPlatformDefinition(
        normalized: ServiceSpec,
        replaced: ServiceSpec | null,
    ): Promise<void> {
        const paths = this.paths();
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
            const files = getWindowsUserServiceFiles(paths.stateDir);
            writeServiceFile(files.runner, renderWindowsUserRunner(normalized, files.log));
            writeServiceFile(
                files.definition,
                renderWindowsUserTaskXml(normalized.nodePath, files.runner),
                "utf16le",
            );
            this.host.exec(
                "schtasks.exe",
                ["/Create", "/F", "/TN", WINDOWS_TASK_NAME, "/XML", files.definition],
                { inherit: true },
            );
            if (fs.existsSync(files.legacyRunner)) fs.unlinkSync(files.legacyRunner);
        } else if (this.host.platform === "win32") {
            if (replaced) {
                await waitForNodeWindows(
                    createNodeWindowsService(replaced, paths.stateDir),
                    "uninstall",
                );
            }
            const files = getWindowsSystemServiceFiles(normalized, paths.stateDir);
            writeServiceFile(files.runner, renderWindowsSystemRunner(normalized));
            const service = createNodeWindowsService(normalized, paths.stateDir);
            if (service.exists) await waitForNodeWindows(service, "uninstall");
            await waitForNodeWindows(service, "install");
        } else {
            throw new Error(`不支持的操作系统: ${this.host.platform}`);
        }
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
            this.host.exec("sc.exe", ["start", WINDOWS_SYSTEM_SERVICE_ID], { inherit: true });
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
            this.host.exec("sc.exe", ["stop", WINDOWS_SYSTEM_SERVICE_ID], {
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
                        "show",
                        "--property=ActiveState",
                        "--value",
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
            detail = this.host.exec("sc.exe", ["query", WINDOWS_SYSTEM_SERVICE_ID]).trim();
            return { installed: true, running: /RUNNING/.test(detail), scope: this.scope, detail };
        } catch (error) {
            const detail = serviceStatusErrorDetail(error);
            if (this.host.platform === "darwin" && launchdServiceIsNotLoaded(detail)) {
                return {
                    installed: true,
                    running: false,
                    scope: this.scope,
                    detail: "launchd 任务未加载",
                };
            }
            return {
                installed: true,
                running: false,
                scope: this.scope,
                detail,
                error: "进程管理器状态查询失败",
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

    async uninstall(options: ServiceUninstallOptions = {}): Promise<void> {
        ensureSystemPermission(this.scope, this.host);
        const paths = this.paths();
        const spec = this.readSpec();
        if (!spec) return;
        await this.stop(true);
        try {
            await (
                options.verifyStopped ?? (() => verifyServiceStopped(() => this.status(spec)))
            )();
        } catch (error) {
            throw new Error(
                `服务卸载已中止，平台定义和元数据已保留：${error instanceof Error ? error.message : String(error)}`,
            );
        }
        await this.removePlatformDefinition(spec);
        if (fs.existsSync(paths.metadata)) fs.unlinkSync(paths.metadata);
    }

    private async removePlatformDefinition(spec: ServiceSpec): Promise<void> {
        const paths = this.paths();
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
            const files = getWindowsUserServiceFiles(paths.stateDir);
            for (const file of [files.definition, files.runner, files.legacyRunner]) {
                if (fs.existsSync(file)) fs.unlinkSync(file);
            }
        } else {
            const service = createNodeWindowsService(spec, paths.stateDir);
            if (service.exists) await waitForNodeWindows(service, "uninstall");
            const runner = getWindowsSystemServiceFiles(spec, paths.stateDir).runner;
            if (fs.existsSync(runner)) fs.unlinkSync(runner);
        }
    }

    private readValidSpecForRollback(): ServiceSpec | null {
        try {
            return this.readSpec();
        } catch (error) {
            // 损坏的元数据不是可恢复契约；安装成功后会由新元数据原子替换。
            void error;
            return null;
        }
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

function serviceStatusErrorDetail(error: unknown): string {
    const commandError = error as Error & { stderr?: string | Buffer; stdout?: string | Buffer };
    const output = [commandError.stderr, commandError.stdout]
        .map(value => value?.toString().trim())
        .find(Boolean);
    return output || commandError.message || String(error);
}

function launchdServiceIsNotLoaded(detail: string): boolean {
    return /could not find service|service .* not found|unknown service|no such process/iu.test(
        detail,
    );
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
                Service: new (options: WindowsSystemServiceOptions) => NodeWindowsService;
            }
        ).Service;
        const service = new Service(buildWindowsSystemServiceOptions(spec, logPath));
        service.directory(path.dirname(path.resolve(spec.binPath)));
        return service;
    } catch {
        throw new Error("Windows 系统服务需要可选依赖 node-windows，请重新安装 OneBots 后再试。");
    }
}

function resolveNodeWindowsWrapper(): string {
    const require = createRequire(import.meta.url);
    try {
        return path.join(path.dirname(require.resolve("node-windows")), "wrapper.js");
    } catch {
        throw new Error("Windows 系统服务需要可选依赖 node-windows，请重新安装 OneBots 后再试。");
    }
}

function tailFile(file: string, lineCount: number): string {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - lineCount - 1)).join("\n");
}
