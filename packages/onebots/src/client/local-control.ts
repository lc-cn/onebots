import http from "node:http";
import { ControlClient, ControlRequestError, type ControlTransport } from "@onebots/core/control";
import { controlSocket } from "../control/workspace.js";
import {
    createWindowsNativeHostExchange,
    WindowsHostControlClient,
} from "../windows-host-control-client.js";
import { WINDOWS_HOST_PIPE_NAME } from "../service-platform-windows.js";

export function createLocalControlTransport(workspace: string): ControlTransport {
    if (process.platform === "win32") {
        // 服务控制 SID 只有最小 pipe 权限；libuv 会申请更宽的 GENERIC_READ/WRITE。
        // 随包原生桥使用精确权限连接，且控制请求只经 stdin 传递。
        const client = new WindowsHostControlClient(
            WINDOWS_HOST_PIPE_NAME,
            createWindowsNativeHostExchange(),
        );
        return {
            async request<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
                const response = await client.request<T>(method, route, body);
                if (response.status < 200 || response.status >= 300)
                    throw new ControlRequestError(
                        response.status,
                        response.body &&
                            typeof response.body === "object" &&
                            "message" in response.body &&
                            typeof response.body.message === "string"
                            ? response.body.message
                            : "本地控制请求失败",
                    );
                return response.body;
            },
        };
    }
    const transport: ControlTransport = {
        request<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
            return new Promise((resolve, reject) => {
                // 发布检查包含远端目录与归档验证；仅此只读检查允许较长等待。
                const timeout =
                    method === "POST" && route === "/api/control/updates/plan" ? 120_000 : 60_000;
                const request = http.request(
                    {
                        socketPath: controlSocket(workspace),
                        path: route,
                        method,
                        headers: { "Content-Type": "application/json" },
                    },
                    response => {
                        const chunks: Buffer[] = [];
                        let size = 0;
                        response.on("data", chunk => {
                            size += chunk.length;
                            if (size > 1024 * 1024) {
                                response.destroy(new Error("控制响应过大"));
                                return;
                            }
                            chunks.push(chunk);
                        });
                        response.on("error", reject);
                        response.on("end", () => {
                            try {
                                const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                                if (
                                    !response.statusCode ||
                                    response.statusCode < 200 ||
                                    response.statusCode >= 300
                                )
                                    throw new ControlRequestError(
                                        response.statusCode ?? 0,
                                        data.message ?? "本地控制请求失败",
                                    );
                                resolve(data as T);
                            } catch (error) {
                                reject(error);
                            }
                        });
                    },
                );
                request.setTimeout(timeout, () =>
                    request.destroy(new Error("控制操作结果暂不可确认，请查询状态")),
                );
                // socket idle timeout不能阻止持续小块响应；总期限同样有界。
                const deadline = setTimeout(
                    () => request.destroy(new Error("控制操作结果暂不可确认，请查询状态")),
                    timeout,
                );
                deadline.unref();
                request.once("close", () => clearTimeout(deadline));
                request.on("error", reject);
                request.end(body === undefined ? undefined : JSON.stringify(body));
            });
        },
    };
    return transport;
}

export function createLocalControlClient(workspace: string): ControlClient {
    return new ControlClient(createLocalControlTransport(workspace));
}
