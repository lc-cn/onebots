import * as fs from "node:fs";
import type { DoctorCheck } from "./doctor-endpoint.js";

/** 验证服务元数据与日志所在路径确实是当前进程可遍历、读写的目录。 */
export function inspectDoctorServiceStateDirectory(stateDirectory: string): DoctorCheck {
    try {
        if (!fs.statSync(stateDirectory).isDirectory()) {
            return {
                name: "service-permissions",
                level: "error",
                message: `服务状态路径不是目录: ${stateDirectory}`,
            };
        }
        fs.accessSync(stateDirectory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
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
