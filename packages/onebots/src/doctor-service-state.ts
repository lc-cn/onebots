import * as fs from "node:fs";
import type { DoctorCheck } from "./doctor-endpoint.js";

/** 验证服务元数据与日志所在路径确实是当前进程可遍历、读写的目录。 */
export function inspectDoctorServiceStateDirectory(
    stateDirectory: string,
    fix = false,
): DoctorCheck {
    try {
        const stats = fs.statSync(stateDirectory);
        if (!stats.isDirectory()) {
            return {
                name: "service-permissions",
                level: "error",
                message: `服务状态路径不是目录: ${stateDirectory}`,
            };
        }
        fs.accessSync(stateDirectory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
        if (process.platform !== "win32") {
            const mode = stats.mode & 0o777;
            const formattedMode = mode.toString(8).padStart(3, "0");
            const hasPublicAccess = (mode & 0o007) !== 0;
            const hasGroupMutation = (mode & 0o020) !== 0;
            if (hasPublicAccess || hasGroupMutation) {
                if (fix) {
                    fs.chmodSync(stateDirectory, 0o700);
                    return {
                        name: "service-permissions",
                        level: "ok",
                        message: `已将服务状态目录权限从 ${formattedMode} 收紧为 0700`,
                        fixed: true,
                    };
                }
                return {
                    name: "service-permissions",
                    level: "error",
                    message: `服务状态目录权限 ${formattedMode} 允许其他用户访问或同组用户修改（--fix 可收紧为 0700）`,
                };
            }
            if ((mode & 0o070) !== 0) {
                return {
                    name: "service-permissions",
                    level: "warning",
                    message: `服务状态目录权限 ${formattedMode} 允许同组用户访问；请确认日志共享是部署所需`,
                };
            }
        }
        return {
            name: "service-permissions",
            level: "ok",
            message: `服务状态目录可读写: ${stateDirectory}`,
        };
    } catch {
        return {
            name: "service-permissions",
            level: "error",
            message: `服务状态目录不可用: ${stateDirectory}`,
        };
    }
}
