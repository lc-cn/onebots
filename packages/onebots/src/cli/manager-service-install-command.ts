import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installManagerService } from "../manager-service-install.js";
import { parseManagerServiceSpec } from "../manager-service-spec.js";
import type { CommandResult } from "./command-application.js";

export interface ManagerServiceInstallCommandOptions {
    dataDir?: string;
    host?: string;
    port?: number;
    system?: boolean;
}
/** 只读解析现有祖先；不存在的后缀留给已授权安装事务创建。 */
function futureWorkspace(input: string): string {
    if (typeof input !== "string" || !input || /[\u0000-\u001f\u007f]/.test(input))
        throw new Error();
    let ancestor = path.resolve(input);
    const remaining: string[] = [];
    for (;;) {
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(ancestor);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            const parent = path.dirname(ancestor);
            if (parent === ancestor) throw new Error();
            remaining.unshift(path.basename(ancestor));
            ancestor = parent;
            continue;
        }
        // lstat发现悬空symlink后realpath必须失败，不能继续当不存在祖先处理。
        const canonical = fs.realpathSync(ancestor);
        if (!(stat.isDirectory() || stat.isSymbolicLink()) || !fs.statSync(canonical).isDirectory())
            throw new Error();
        return path.join(canonical, ...remaining);
    }
}
function quote(value: string): string {
    return "'" + value.replaceAll("'", "'\\''") + "'";
}

export async function installManagerServiceCommand(
    options: ManagerServiceInstallCommandOptions,
): Promise<CommandResult> {
    let spec;
    try {
        if (
            !options ||
            typeof options !== "object" ||
            Array.isArray(options) ||
            Object.keys(options).some(
                key => !["dataDir", "host", "port", "system"].includes(key),
            ) ||
            (options.dataDir !== undefined && typeof options.dataDir !== "string") ||
            (options.host !== undefined && typeof options.host !== "string") ||
            (options.port !== undefined && typeof options.port !== "number") ||
            (options.system !== undefined && typeof options.system !== "boolean")
        )
            throw new Error();
        spec = parseManagerServiceSpec({
            schemaVersion: 1,
            runtimeKind: "control",
            scope: options.system ? "system" : "user",
            workspace: futureWorkspace(
                options.dataDir ?? process.env.ONEBOTS_WORKSPACE ?? process.cwd(),
            ),
            workingDirectory: fs.realpathSync(process.cwd()),
            nodePath: process.execPath,
            binPath: fileURLToPath(new URL("../bin.js", import.meta.url)),
            host: options.host ?? "127.0.0.1",
            port: options.port ?? 6727,
        });
    } catch {
        return { output: "管理服务安装选项或目录无法确认，未执行安装。", exitCode: 2 };
    }
    try {
        const operation = await installManagerService(spec);
        const label =
            "操作 " + operation.id + "：" + operation.status + "（" + operation.phase + "）";
        if (
            operation.status === "succeeded" &&
            operation.phase === "completed" &&
            !operation.recoveryRequired
        )
            return {
                output:
                    label +
                    "\n管理服务已安装，尚未启动。启动：\nonebots start" +
                    (spec.scope === "system" ? " --system" : "") +
                    "\n启动后在本机签发配对码：\nonebots auth bootstrap --data-dir " +
                    quote(spec.workspace),
                exitCode: 0,
            };
        return {
            output: label + "\n安装结果尚未确认，已保留操作记录；请在本机对账，勿重复安装。",
            exitCode: 1,
        };
    } catch {
        return {
            output: "管理服务安装未完成，操作标识暂不可用；请检查本机服务记录。旧服务须执行 onebots migrate，勿重复安装或覆盖。",
            exitCode: 1,
        };
    }
}
