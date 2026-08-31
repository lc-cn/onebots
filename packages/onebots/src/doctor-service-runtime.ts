import { execFileSync } from "node:child_process";
import {
    inspectNodeRuntime,
    MINIMUM_NODE_MAJOR,
    unsupportedNodeRuntimeMessage,
} from "./runtime-version.js";
import type { DoctorCheck } from "./doctor-endpoint.js";

export interface DoctorServiceRuntimeInspection {
    supported: boolean;
    check: DoctorCheck;
}

type NodeVersionReader = (nodePath: string) => string;

/** 验证服务定义实际保存的 Node 二进制，而不是用当前 doctor 进程代替服务运行时。 */
export function inspectServiceNodeRuntime(
    nodePath: string,
    readVersion: NodeVersionReader = readNodeVersion,
): DoctorServiceRuntimeInspection {
    let version: string;
    try {
        version = readVersion(nodePath).trim();
    } catch {
        return {
            supported: false,
            check: {
                name: "service-node",
                level: "error",
                message: `服务 Node.js 无法执行: ${nodePath}`,
            },
        };
    }

    const runtime = inspectNodeRuntime(version);
    if (!runtime.supported) {
        return {
            supported: false,
            check: {
                name: "service-node",
                level: "error",
                message: `服务定义 ${nodePath}：${unsupportedNodeRuntimeMessage(runtime)}`,
            },
        };
    }
    return {
        supported: true,
        check: {
            name: "service-node",
            level: "ok",
            message: `服务 Node.js ${runtime.version}（要求 >=${MINIMUM_NODE_MAJOR}）：${nodePath}`,
        },
    };
}

function readNodeVersion(nodePath: string): string {
    return execFileSync(nodePath, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
    });
}
