import * as fs from "node:fs";
import * as path from "node:path";
import type { ServiceController, ServiceSpec } from "./service-manager.js";
import type { DoctorCheck } from "./doctor-endpoint.js";
import type { DoctorServiceEntryInspection } from "./doctor-service-entry.js";
import type { DoctorServiceRuntimeInspection } from "./doctor-service-runtime.js";
import { inspectSensitiveDirectoryMutationPermissions } from "./doctor-permissions.js";

export interface DoctorServiceDefinitionInspection {
    current: boolean;
    error: string | null;
}

export interface DoctorServiceRepairOptions {
    controller: ServiceController;
    previousSpec: ServiceSpec;
    repairedSpec: ServiceSpec;
    previousRuntime: DoctorServiceRuntimeInspection;
    previousEntry: DoctorServiceEntryInspection;
    runtimeInspector: (nodePath: string) => DoctorServiceRuntimeInspection;
    entryInspector: (binPath: string) => DoctorServiceEntryInspection;
    definitionInspector: (
        controller: ServiceController,
        spec: ServiceSpec,
    ) => DoctorServiceDefinitionInspection;
}

/** 将平台服务定义的读取或比对异常收敛为 doctor 可持久化的脱敏证据。 */
export function inspectDoctorServiceDefinition(
    controller: Pick<ServiceController, "definitionIsCurrent" | "definitionPath">,
    spec: ServiceSpec,
): DoctorServiceDefinitionInspection {
    try {
        return { current: controller.definitionIsCurrent(spec), error: null };
    } catch {
        return {
            current: false,
            error: `服务平台定义无法读取或验证: ${controller.definitionPath(spec)}`,
        };
    }
}

/** unit/plist 可公开读取，但不得允许组或其他用户修改启动契约。 */
export function inspectDoctorServiceDefinitionPermissions(
    definitionPath: string,
    fix = false,
): DoctorCheck {
    try {
        if (!fs.statSync(definitionPath).isFile()) {
            return {
                name: "service-definition-mode",
                level: "error",
                message: `服务定义路径不是文件: ${definitionPath}`,
            };
        }
        const mode = fs.statSync(definitionPath).mode & 0o777;
        const formattedMode = mode.toString(8).padStart(3, "0");
        if ((mode & 0o022) === 0) {
            return {
                name: "service-definition-mode",
                level: "ok",
                message: `服务定义权限 ${formattedMode} 未向组或其他用户开放写入`,
            };
        }
        if (fix) {
            fs.chmodSync(definitionPath, 0o644);
            return {
                name: "service-definition-mode",
                level: "ok",
                message: `已将服务定义权限从 ${formattedMode} 收紧为 0644`,
                fixed: true,
            };
        }
        return {
            name: "service-definition-mode",
            level: "error",
            message: `服务定义权限 ${formattedMode} 允许组或其他用户修改（用户级 --fix 可收紧为 0644）`,
        };
    } catch {
        return {
            name: "service-definition-mode",
            level: "error",
            message: `服务定义权限无法验证: ${definitionPath}`,
        };
    }
}

/** 文件权限不能抵御可写父目录中的服务定义路径替换。 */
export function inspectServiceDefinitionDirectoryPermissions(definitionPath: string): DoctorCheck {
    return inspectSensitiveDirectoryMutationPermissions(
        path.dirname(definitionPath),
        "service-definition-dir-mode",
        "服务定义目录",
        "服务定义",
    );
}

/** 修复用户级服务并重新取证；安装异常不得中断 doctor 或泄露底层命令输出。 */
export async function repairDoctorUserService(
    options: DoctorServiceRepairOptions,
): Promise<DoctorCheck[]> {
    try {
        await options.controller.install(options.repairedSpec);
    } catch {
        return [
            options.previousRuntime.check,
            options.previousEntry.check,
            {
                name: "service-definition",
                level: "error",
                message: `用户级服务定义修复失败: ${options.controller.definitionPath(options.repairedSpec)}`,
            },
        ];
    }

    const repairedRuntime = options.runtimeInspector(options.repairedSpec.nodePath);
    const repairedEntry = options.entryInspector(options.repairedSpec.binPath);
    const repairedDefinition = options.definitionInspector(
        options.controller,
        options.repairedSpec,
    );
    return [
        {
            ...repairedRuntime.check,
            ...(!options.previousRuntime.supported ||
            options.previousSpec.nodePath !== options.repairedSpec.nodePath
                ? { fixed: true }
                : {}),
        },
        {
            ...repairedEntry.check,
            ...(!options.previousEntry.valid ||
            options.previousSpec.binPath !== options.repairedSpec.binPath
                ? { fixed: true }
                : {}),
        },
        {
            name: "service-definition",
            level: repairedDefinition.current ? "ok" : "error",
            message: repairedDefinition.current
                ? "已重新生成并验证用户级服务定义"
                : (repairedDefinition.error ?? "重新生成后的服务定义仍与元数据不一致"),
            ...(repairedDefinition.current ? { fixed: true } : {}),
        },
    ];
}
