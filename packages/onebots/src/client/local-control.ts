import http from "node:http";
import { ControlClient, ControlRequestError, type ControlTransport } from "@onebots/core/control";
import { controlSocket } from "../control/workspace.js";

export function createLocalControlTransport(workspace: string): ControlTransport {
    const transport: ControlTransport = {
        request<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
            return new Promise((resolve, reject) => {
                // 发布检查包含远端目录与归档验证；仅此只读检查允许较长等待。
                const timeout = method === "POST" && route === "/api/control/updates/plan"
                    ? 120_000 : 60_000;
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
