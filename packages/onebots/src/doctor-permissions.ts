import * as fs from "node:fs";
import type { DoctorCheck } from "./doctor-endpoint.js";

/** 检查包含敏感数据的 POSIX 文件权限；组只读可见但不自动破坏部署授权。 */
export function inspectSensitiveFilePermissions(
    filePath: string,
    name: string,
    label: string,
    fix = false,
    offerFix = true,
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
            message: offerFix
                ? `${label}权限 ${formattedMode} 允许其他用户访问或同组用户修改（--fix 可收紧为 0600）`
                : `${label}权限 ${formattedMode} 允许其他用户访问或同组用户修改；请由文件所有者收紧为 0600`,
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

/** 敏感文件即使为 0600，也不能抵御其他用户在可写父目录中替换同一路径。 */
export function inspectSensitiveDirectoryMutationPermissions(
    directoryPath: string,
    name = "config-dir-mode",
    directoryLabel = "配置目录",
    targetLabel = "配置路径",
): DoctorCheck {
    try {
        const stats = fs.statSync(directoryPath);
        if (!stats.isDirectory()) {
            return {
                name,
                level: "error",
                message: `${directoryLabel}父路径不是目录: ${directoryPath}`,
            };
        }
        const mode = stats.mode & 0o1777;
        const formattedMode = formatMode(mode);
        if ((mode & 0o022) !== 0) {
            if ((mode & 0o1000) !== 0) {
                return {
                    name,
                    level: "warning",
                    message: `${directoryLabel}权限 ${formattedMode} 允许共享写入但启用了 sticky bit；请确认这是隔离后的临时部署目录`,
                };
            }
            return {
                name,
                level: "error",
                message: `${directoryLabel}权限 ${formattedMode} 允许组或其他用户替换${targetLabel}；请由目录所有者移除对应写权限`,
            };
        }
        return {
            name,
            level: "ok",
            message: `${directoryLabel}权限 ${formattedMode} 不允许组或其他用户替换${targetLabel}`,
        };
    } catch (error) {
        const code =
            error instanceof Error && "code" in error && typeof error.code === "string"
                ? error.code
                : "UNKNOWN";
        return {
            name,
            level: "error",
            message: `${directoryLabel}权限无法验证: ${directoryPath} (${code})`,
        };
    }
}

function formatMode(mode: number): string {
    return mode.toString(8).padStart(3, "0");
}
