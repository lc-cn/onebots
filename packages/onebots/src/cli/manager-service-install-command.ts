import fs from "node:fs";
import path from "node:path";
import { bootstrapManagerService } from "../manager-service-bootstrap.js";
import { bundledRuntimeArtifacts } from "../installation/bundled-runtime-artifacts.js";
import { parseManagerServiceSpec } from "../manager-service-spec.js";
import type { CommandResult } from "./command-application.js";
import {
    ManagerBootstrapCandidateError,
    ManagerBootstrapSetupError,
    ManagerBootstrapStageError,
} from "../manager-bootstrap-error.js";

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
            binPath: process.execPath,
            host: options.host ?? "127.0.0.1",
            port: options.port ?? 6727,
        });
    } catch {
        return { output: "管理服务安装选项或目录无法确认，未执行安装。", exitCode: 2 };
    }
    try {
        const service = {
            schemaVersion: spec.schemaVersion,
            runtimeKind: spec.runtimeKind,
            scope: spec.scope,
            workspace: spec.workspace,
            nodePath: spec.nodePath,
            host: spec.host,
            port: spec.port,
        };
        const operation = await bootstrapManagerService(
            { service },
            { artifacts: bundledRuntimeArtifacts() },
        );
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
                    "\n管理服务已注册；本命令不会启动服务。启动：\nonebots start" +
                    (spec.scope === "system" ? " --system" : "") +
                    "\n启动后在本机签发配对码：\nonebots auth bootstrap --data-dir " +
                    quote(spec.workspace),
                exitCode: 0,
            };
        return {
            output:
                label +
                "\n安装结果尚未确认，未重派注册；可核验已完成的安装效果：\nonebots recover --operation " +
                operation.id +
                (spec.scope === "system" ? " --system" : "") +
                "\n该命令只对账，不重装或启动；中途失败仍会保留恢复门禁。",
            exitCode: 1,
        };
    } catch (error) {
        if (error instanceof ManagerBootstrapSetupError)
            return {
                output:
                    `管理服务首次安装失败：operationId=unavailable，bootstrapPhase=${error.bootstrapPhase}，code=${error.code}` +
                    (error.securityStage ? `，securityStage=${error.securityStage}` : "") +
                    "。" +
                    "\n未下载候选或派发系统服务注册；请修复对应的本机前置条件后重试。",
                exitCode: 1,
            };
        if (error instanceof ManagerBootstrapCandidateError) {
            return {
                output:
                    `管理服务首次安装失败：operationId=${error.operationId}，bootstrapPhase=candidate-${error.phase}，code=${error.code}。` +
                    "\n尚未派发系统服务注册；请保留 manager-artifacts 中的原操作和候选证据。",
                exitCode: 1,
            };
        }
        if (error instanceof ManagerBootstrapStageError)
            return {
                output:
                    `管理服务首次安装失败：operationId=${error.operationId}，bootstrapPhase=${error.bootstrapPhase}，code=${error.code}。` +
                    "\n未重派下载或系统动作；请保留原操作和本机持久证据。",
                exitCode: 1,
            };
        return {
            output: "管理服务安装未完成，操作标识暂不可用；请检查本机服务记录。旧服务须执行 onebots migrate，勿重复安装或覆盖。",
            exitCode: 1,
        };
    }
}
