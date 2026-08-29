import { QQBot, type QQBotOptions } from "@tencent-connect/qqbot-nodejs";
import { QQApiError } from "./errors.js";
import type { QQPlatformCall } from "./types.js";

const RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const;

interface ClientLogger {
    warn(message: string, ...args: unknown[]): unknown;
    error(message: string, ...args: unknown[]): unknown;
}

/** 腾讯官方 SDK 的 OneBots 客户端封装：保留完整 SDK 类型并补充稳定生命周期。 */
export class QQClient extends QQBot {
    private runController?: AbortController;

    constructor(
        options: QQBotOptions,
        private readonly adapterLogger: ClientLogger,
    ) {
        super(options);
    }

    /** 持续接收事件；SDK 内部重连耗尽后会重新建立一个全新的连接代次。 */
    async run(): Promise<void> {
        if (this.runController) throw new QQApiError("QQ Client 已启动", { code: "QQ_STARTED" });
        const controller = new AbortController();
        this.runController = controller;
        let generation = 0;
        try {
            while (!controller.signal.aborted) {
                try {
                    await super.start(controller.signal);
                    if (!controller.signal.aborted) {
                        this.adapterLogger.warn("QQ 接收连接意外结束，将建立新连接代次");
                    }
                } catch (error) {
                    if (controller.signal.aborted) break;
                    this.adapterLogger.error("QQ 接收连接失败", QQApiError.wrap(error));
                }
                if (controller.signal.aborted) break;
                const delay = RETRY_DELAYS[Math.min(generation, RETRY_DELAYS.length - 1)];
                generation += 1;
                await waitForRetry(delay, controller.signal);
            }
        } finally {
            this.runController = undefined;
        }
    }

    close(): void {
        this.runController?.abort();
        super.stop();
    }

    /** 经 SDK 认证与结构化错误处理调用任意 QQ OpenAPI。 */
    async call<T = unknown>(request: QQPlatformCall): Promise<T> {
        if (!isSafeApiPath(request.path)) {
            throw new QQApiError("QQ OpenAPI path 必须是以单个 / 开头的相对路径", {
                code: "QQ_INVALID_API_PATH",
                path: request.path,
            });
        }
        const pathWithQuery = appendQuery(request.path, request.query);
        try {
            switch (request.method) {
                case "GET":
                    return await this.api.get<T>(request.path, request.query);
                case "POST":
                    return await this.api.post<T>(pathWithQuery, request.body);
                case "PUT":
                    return await this.api.put<T>(pathWithQuery, request.body);
                case "PATCH":
                    return await this.api.patch<T>(pathWithQuery, request.body);
                case "DELETE":
                    return await this.api.delete<T>(pathWithQuery);
            }
        } catch (error) {
            throw QQApiError.wrap(error);
        }
    }
}

function isSafeApiPath(path: string): boolean {
    if (!path.startsWith("/") || path.startsWith("//") || /[?#\\\u0000-\u001f]/u.test(path)) {
        return false;
    }
    try {
        return !path
            .split("/")
            .map(segment => decodeURIComponent(segment))
            .some(segment => segment === ".." || segment === ".");
    } catch {
        return false;
    }
}

function appendQuery(
    path: string,
    query: Record<string, string | number | boolean> | undefined,
): string {
    if (!query || Object.keys(query).length === 0) return path;
    const separator = path.includes("?") ? "&" : "?";
    const encoded = new URLSearchParams(
        Object.entries(query).map(([key, value]) => [key, String(value)]),
    );
    return `${path}${separator}${encoded}`;
}

async function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>(resolve => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(resolve, delay);
        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}
