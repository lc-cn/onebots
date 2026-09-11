import fs from "node:fs";
import path from "node:path";
import { readServiceMetadata } from "../service-metadata.js";
import { getServiceFiles } from "../service-files.js";
import { SERVICE_NAME } from "../service-definition.js";
import { renderInstalledManagerService } from "../manager-service-definition.js";
import { ConfigurationFile } from "../configuration/configuration-file.js";
import { createDefaultServiceHost, type ServiceHost } from "../service-host.js";
import type { ScopeOptions } from "./command-options.js";
import type { CommandResult } from "./command-application.js";

export interface ManagerServiceLogsOptions extends ScopeOptions {
    follow?: boolean;
    lines?: number;
}
/** 只读系统托管日志；不加载旧生命周期控制器或业务配置，不创建任何目录。 */
export async function managerServiceLogsCommand(
    options: ManagerServiceLogsOptions,
    host: ServiceHost = createDefaultServiceHost(),
): Promise<CommandResult> {
    const lines = options.lines ?? 100;
    if (
        !Number.isInteger(lines) ||
        lines < 1 ||
        lines > 10_000 ||
        (options.follow !== undefined && typeof options.follow !== "boolean")
    )
        return { exitCode: 1, output: "日志行数必须是 1 至 10000 的整数；follow 必须是布尔值。" };
    if (!["linux", "darwin"].includes(host.platform))
        return { exitCode: 1, output: "此系统尚未通过管理服务日志验收。" };
    const scope = options.system ? "system" : "user";
    try {
        const files = getServiceFiles(scope, host);
        const metadata = readServiceMetadata(files.metadata);
        if (metadata.kind === "legacy")
            return {
                exitCode: 1,
                output: "检测到旧服务，请先执行 onebots migrate；未使用旧日志路径。",
            };
        if (metadata.kind === "missing")
            return { exitCode: 1, output: "管理服务尚未安装，未读取日志。" };
        if (metadata.kind !== "control" || metadata.spec.scope !== scope)
            return { exitCode: 1, output: "管理服务元数据无效，未读取日志。" };
        const expected = renderInstalledManagerService(
            metadata.spec,
            host.platform,
            files.stateDir,
        );
        if (!new ConfigurationFile(files.definition).readRaw().bytes.equals(Buffer.from(expected)))
            return { exitCode: 1, output: "管理服务定义与元数据不一致，未读取日志。" };
        let command: string;
        let args: string[];
        if (host.platform === "linux") {
            command = "journalctl";
            args = [
                ...(scope === "user" ? ["--user"] : []),
                "--no-pager",
                "-u",
                `${SERVICE_NAME}.service`,
                "-n",
                String(lines),
                ...(options.follow ? ["-f"] : []),
            ];
        } else {
            const logs: string[] = [];
            for (const name of ["onebots.log", "onebots-error.log"]) {
                const file = path.join(files.stateDir, name);
                let stat: fs.Stats;
                try {
                    stat = fs.lstatSync(file);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
                    throw error;
                }
                if (
                    !stat.isFile() ||
                    stat.isSymbolicLink() ||
                    stat.nlink !== 1 ||
                    (stat.mode & 0o022) !== 0 ||
                    stat.uid !== (scope === "system" ? 0 : host.uid)
                )
                    throw new Error("日志文件边界不安全");
                logs.push(file);
            }
            if (!logs.length) return { exitCode: 0, output: "暂无管理服务日志。" };
            command = "/usr/bin/tail";
            args = ["-n", String(lines), ...(options.follow ? ["-f"] : []), ...logs];
        }
        if (options.follow) {
            if ((await host.spawn(command, args)) !== 0) throw new Error("日志跟随未完成");
            return { exitCode: 0 };
        }
        return { exitCode: 0, output: host.exec(command, args, { timeoutMs: 5000 }) };
    } catch {
        return { exitCode: 1, output: "管理服务日志不可用，请检查本机文件边界与读取权限。" };
    }
}
