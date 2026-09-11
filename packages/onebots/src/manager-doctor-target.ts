import fs from "node:fs";
import path from "node:path";
import { readServiceMetadata } from "./service-metadata.js";
import { getServiceFiles } from "./service-files.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceScope } from "./service-definition.js";

export type ManagerDoctorTarget =
    | { kind: "foreground"; workspace: string; scope: ServiceScope }
    | { kind: "service"; workspace: string; scope: ServiceScope; spec: ManagerServiceSpec }
    | {
          kind: "unavailable";
          reason: "missing" | "legacy" | "invalid" | "workspace-unavailable" | "unsupported";
          message: string;
      };
export interface ManagerDoctorTargetOptions {
    dataDir?: string;
    system?: boolean;
}
function workspace(input: string): string {
    if (typeof input !== "string" || !input.length || /[\u0000-\u001f\u007f]/.test(input))
        throw new Error();
    const resolved = path.resolve(input);
    for (let current = resolved; ; current = path.dirname(current)) {
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
        if (path.dirname(current) === current) break;
    }
    return resolved;
}
/** 仅解析已有目标；绝不以诊断名义创建工作区或读取业务 YAML。 */
export function resolveManagerDoctorTarget(
    options: ManagerDoctorTargetOptions,
    host: ServiceHost = createDefaultServiceHost(),
): ManagerDoctorTarget {
    const scope = options.system ? "system" : "user";
    if (options.system !== undefined && typeof options.system !== "boolean")
        return { kind: "unavailable", reason: "invalid", message: "诊断范围参数无效。" };
    if (options.dataDir !== undefined) {
        try {
            return { kind: "foreground", workspace: workspace(options.dataDir), scope };
        } catch {
            return {
                kind: "unavailable",
                reason: "workspace-unavailable",
                message: "指定工作区不存在或目录边界不安全；未创建目录。",
            };
        }
    }
    if (!["linux", "darwin"].includes(host.platform))
        return {
            kind: "unavailable",
            reason: "unsupported",
            message: "此系统的管理服务诊断尚未验收，请显式指定现有工作区。",
        };
    try {
        const metadata = readServiceMetadata(getServiceFiles(scope, host).metadata);
        if (metadata.kind === "missing")
            return {
                kind: "unavailable",
                reason: "missing",
                message: "未安装管理服务；前台或 Docker 请用 --data-dir 指定现有工作区。",
            };
        if (metadata.kind === "legacy")
            return {
                kind: "unavailable",
                reason: "legacy",
                message: "检测到旧服务，请先执行 onebots migrate；未采用旧配置路径。",
            };
        if (metadata.kind !== "control" || metadata.spec.scope !== scope)
            return {
                kind: "unavailable",
                reason: "invalid",
                message: "管理服务元数据无效，未猜测诊断工作区。",
            };
        try {
            return {
                kind: "service",
                workspace: workspace(metadata.spec.workspace),
                scope,
                spec: metadata.spec,
            };
        } catch {
            return {
                kind: "unavailable",
                reason: "workspace-unavailable",
                message: "服务工作区不存在或目录边界不安全；未创建目录。",
            };
        }
    } catch {
        return {
            kind: "unavailable",
            reason: "invalid",
            message: "管理服务元数据不可验证，未猜测诊断工作区。",
        };
    }
}
