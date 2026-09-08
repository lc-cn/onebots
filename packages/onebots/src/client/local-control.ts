import http from "node:http";
import { ControlClient, type ControlTransport } from "@onebots/core/control";
import { controlSocket } from "../control/workspace.js";

export function createLocalControlClient(workspace: string): ControlClient {
    const transport: ControlTransport = {
        request<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
            return new Promise((resolve, reject) => {
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
                                if (response.statusCode !== 200)
                                    throw new Error(data.message ?? "本地控制请求失败");
                                resolve(data as T);
                            } catch (error) {
                                reject(error);
                            }
                        });
                    },
                );
                request.setTimeout(60_000, () =>
                    request.destroy(new Error("控制操作结果暂不可确认，请查询状态")),
                );
                request.on("error", reject);
                request.end(body === undefined ? undefined : JSON.stringify(body));
            });
        },
    };
    return new ControlClient(transport);
}
