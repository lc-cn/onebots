import * as net from "node:net";
import type { DoctorCheck } from "./doctor-endpoint.js";

/**
 * 使用与 BaseApp 相同的未指定主机监听方式验证端口，而不是只检查回环连接。
 * 成功后立即关闭临时监听器，不保留运行时资源。
 */
export async function inspectGatewayPortAvailability(port: number): Promise<DoctorCheck> {
    try {
        await bindGatewayPort(port);
        return {
            name: "port",
            level: "ok",
            message: `端口 ${port} 可用（已验证实际监听）`,
        };
    } catch (error) {
        return {
            name: "port",
            level: "error",
            message: `端口 ${port} 无法按网关监听方式占用: ${formatBindError(error)}`,
        };
    }
}

function bindGatewayPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        const fail = (error: Error) => {
            server.close(() => reject(error));
        };
        server.once("error", fail);
        server.listen(port, () => {
            server.removeListener("error", fail);
            server.close(error => {
                if (error) reject(error);
                else resolve();
            });
        });
    });
}

function formatBindError(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return code ? `${code}: ${error.message}` : error.message;
}
