import { QQBot, type QQBotOptions } from "@tencent-connect/qqbot-nodejs";
import type { WebhookRequest, WebhookResponse } from "@tencent-connect/qqbot-nodejs/protocol";
import { ErrorCategory } from "onebots";
import { QQApiError } from "./errors.js";
import type { QQPlatformCall, QQUser } from "./types.js";
import { QQStreamSessions } from "./stream-sessions.js";
import { QQWebhookHost, type QQHttpContext } from "./webhook-host.js";

const RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const;

interface ClientLogger {
    warn(message: string, ...args: unknown[]): unknown;
    error(message: string, ...args: unknown[]): unknown;
}

interface ReadyWaiter {
    resolve(): void;
    reject(error: QQApiError): void;
}

/** 腾讯官方 SDK 的 OneBots 客户端封装：保留完整 SDK 类型并补充稳定生命周期。 */
export class QQClient extends QQBot {
    private runController?: AbortController;
    private runPromise?: Promise<void>;
    private startPromise?: Promise<void>;
    private startSignal?: AbortSignal;
    private startSignalAbort?: () => void;
    private transportReady = false;
    private readonly readyWaiters = new Set<ReadyWaiter>();
    private self?: QQUser;
    private readonly streamSessions = new QQStreamSessions();

    constructor(
        options: QQBotOptions,
        private readonly adapterLogger: ClientLogger,
        readonly webhookHost?: QQWebhookHost,
    ) {
        super(options);
        // 必须先于 Adapter 的 READY 监听器注册，让账号启动可以先放行协议出口。
        this.on("ready", () => {
            for (const waiter of [...this.readyWaiters]) waiter.resolve();
        });
    }

    /** 等待首个接收通道 READY，同时让后续协议启动共享同一取消边界。 */
    override async start(signal?: AbortSignal): Promise<void> {
        this.assertStartActive(signal);
        if (this.transportReady) {
            this.bindStartSignal(signal);
            return;
        }
        if (this.startPromise) return this.startPromise;
        this.bindStartSignal(signal);
        const task = this.startAndWait(signal);
        this.startPromise = task;
        try {
            await task;
        } finally {
            if (this.startPromise === task) this.startPromise = undefined;
            if (!this.transportReady && this.startSignal === signal) this.unbindStartSignal();
        }
    }

    private async startAndWait(signal?: AbortSignal): Promise<void> {
        const ready = this.waitForReady(signal);
        const running = this.run();
        void running.catch(error =>
            this.adapterLogger.error("QQ Client 已停止", QQApiError.wrap(error)),
        );
        await ready;
        this.assertStartActive(signal);
        if (!this.self) {
            throw new QQApiError("QQ 接收通道就绪时缺少机器人身份", {
                code: "QQ_START_IDENTITY_MISSING",
            });
        }
        this.transportReady = true;
    }

    private waitForReady(signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            const cleanup = (): void => {
                this.readyWaiters.delete(waiter);
                signal?.removeEventListener("abort", onAbort);
            };
            const waiter: ReadyWaiter = {
                resolve: () => {
                    cleanup();
                    resolve();
                },
                reject: error => {
                    cleanup();
                    reject(error);
                },
            };
            const onAbort = (): void => {
                waiter.reject(this.startCancelled());
            };
            this.readyWaiters.add(waiter);
            signal?.addEventListener("abort", onAbort, { once: true });
            if (signal?.aborted) onAbort();
        });
    }

    private bindStartSignal(signal?: AbortSignal): void {
        this.unbindStartSignal();
        if (!signal) return;
        const abort = (): void => this.close();
        this.startSignal = signal;
        this.startSignalAbort = abort;
        signal.addEventListener("abort", abort, { once: true });
    }

    private unbindStartSignal(): void {
        if (this.startSignal && this.startSignalAbort) {
            this.startSignal.removeEventListener("abort", this.startSignalAbort);
        }
        this.startSignal = undefined;
        this.startSignalAbort = undefined;
    }

    private assertStartActive(signal?: AbortSignal): void {
        if (signal?.aborted) throw this.startCancelled();
    }

    private startCancelled(): QQApiError {
        return new QQApiError("QQ Client 启动已取消", {
            code: "QQ_START_CANCELLED",
            category: ErrorCategory.ADAPTER,
        });
    }

    /** 持续接收事件；初始连接失败或 SDK 代次结束后按无上限退避重新启动。 */
    run(): Promise<void> {
        if (this.runController && !this.runController.signal.aborted) return this.runPromise!;
        const previous = this.runPromise;
        const controller = new AbortController();
        this.runController = controller;
        const promise = this.runGeneration(controller, previous);
        this.runPromise = promise;
        const cleanup = (): void => {
            if (this.runPromise === promise) this.runPromise = undefined;
            if (this.runController === controller) this.runController = undefined;
        };
        void promise.then(cleanup, cleanup);
        return promise;
    }

    private async runGeneration(
        controller: AbortController,
        previous: Promise<void> | undefined,
    ): Promise<void> {
        // stop/start 紧邻发生时必须等旧 SDK 代次完成清理，避免共享 token 与 gateway 状态互相覆盖。
        await previous?.catch(error => {
            this.adapterLogger.error("QQ 旧连接代次清理失败", QQApiError.wrap(error));
        });
        if (controller.signal.aborted || this.runController !== controller) return;
        let generation = 0;
        while (!controller.signal.aborted && this.runController === controller) {
            try {
                await this.ensureSelf(controller.signal);
                if (!controller.signal.aborted && this.runController === controller) {
                    await super.start(controller.signal);
                    if (!controller.signal.aborted) {
                        this.adapterLogger.warn("QQ 接收连接意外结束，将建立新连接代次");
                    }
                }
            } catch (error) {
                if (controller.signal.aborted) break;
                this.adapterLogger.error("QQ 接收连接失败", QQApiError.wrap(error));
            }
            if (controller.signal.aborted || this.runController !== controller) break;
            const delay = RETRY_DELAYS[Math.min(generation, RETRY_DELAYS.length - 1)];
            generation += 1;
            await waitForRetry(delay, controller.signal);
        }
    }

    close(): void {
        this.unbindStartSignal();
        this.transportReady = false;
        this.startPromise = undefined;
        for (const waiter of [...this.readyWaiters]) waiter.reject(this.startCancelled());
        const controller = this.runController;
        this.runController = undefined;
        controller?.abort();
        this.streamSessions.cancelAll();
        super.stop();
    }

    /** 创建仅限 C2C 的 QQ 流式消息会话，并返回供协议动作使用的进程内句柄。 */
    startC2CStream(options: QQC2CStreamOptions): string {
        const session = this.openStream({
            target: { scope: "c2c", targetId: options.targetId, msgId: options.msgId },
            eventId: options.eventId,
            throttleMs: options.throttleMs,
        });
        return this.streamSessions.create(session);
    }

    async updateC2CStream(streamId: string, content: string): Promise<void> {
        try {
            await this.streamSessions.update(streamId, content);
        } catch (error) {
            throw QQApiError.wrap(error, "QQ_STREAM_UPDATE_FAILED");
        }
    }

    async completeC2CStream(streamId: string): Promise<unknown> {
        try {
            return await this.streamSessions.complete(streamId);
        } catch (error) {
            throw QQApiError.wrap(error, "QQ_STREAM_COMPLETE_FAILED");
        }
    }

    cancelC2CStream(streamId: string): void {
        this.streamSessions.cancel(streamId);
    }

    /**
     * 结束已耗尽内部重试的 SDK transport，但保留 OneBots 外层接收循环。
     * 官方 SDK 1.0.4 尚未暴露结构化 exhaustion 事件，因此识别逻辑集中在下方守卫中。
     */
    restartTransportGeneration(): void {
        if (!this.runController || this.runController.signal.aborted) return;
        this.transportReady = false;
        super.stop();
    }

    /** 返回启动前已经通过 OpenAPI 验证的机器人身份。 */
    getCachedSelf(): QQUser | undefined {
        return this.self;
    }

    /** 刷新并校验机器人身份；该身份同时用于 canonical bot_id。 */
    async fetchSelf(signal?: AbortSignal): Promise<QQUser> {
        const value = await this.call<unknown>({ method: "GET", path: "/users/@me" });
        if (signal?.aborted) throw this.startCancelled();
        if (!isRecord(value) || typeof value.id !== "string" || !value.id) {
            throw new QQApiError("QQ OpenAPI 返回了无效的机器人身份", {
                code: "QQ_INVALID_SELF_RESPONSE",
                category: ErrorCategory.ADAPTER,
                details: value,
            });
        }
        const self: QQUser = {
            id: value.id,
            ...(typeof value.username === "string" ? { username: value.username } : {}),
            ...(typeof value.avatar === "string" ? { avatar: value.avatar } : {}),
        };
        this.self = self;
        return self;
    }

    private async ensureSelf(signal?: AbortSignal): Promise<QQUser> {
        return this.self ?? this.fetchSelf(signal);
    }

    /** 将现有 HTTP Host 提取出的原始请求交给官方 SDK 的验签与事件分发管线。 */
    async ingest(request: WebhookRequest): Promise<WebhookResponse> {
        if (!this.webhookHost) {
            throw new QQApiError("QQ Client 未配置 Webhook 接收器", {
                code: "QQ_WEBHOOK_UNAVAILABLE",
                category: ErrorCategory.CONFIG,
            });
        }
        return this.webhookHost.ingest(request);
    }

    /** Fetch / WinterCG Host 适配入口；manual 与 webhook 模式行为一致。 */
    async acceptHttp(request: Request): Promise<Response>;
    /** Koa/OneBots Host 适配入口；manual 与 webhook 模式行为一致。 */
    async acceptHttp(ctx: QQHttpContext): Promise<void>;
    async acceptHttp(request: Request | QQHttpContext): Promise<Response | void> {
        if (!this.webhookHost) {
            throw new QQApiError("QQ Client 未配置 Webhook 接收器", {
                code: "QQ_WEBHOOK_UNAVAILABLE",
                category: ErrorCategory.CONFIG,
            });
        }
        if (isStandardRequest(request)) return this.webhookHost.acceptHttp(request);
        await this.webhookHost.acceptHttp(request);
    }

    /** 经 SDK 认证与结构化错误处理调用任意 QQ OpenAPI。 */
    async call<T = unknown>(request: QQPlatformCall): Promise<T> {
        if (!isSafeApiPath(request.path)) {
            throw QQApiError.invalid(
                "QQ OpenAPI path 必须是以单个 / 开头的相对路径",
                "QQ_INVALID_API_PATH",
                { path: request.path },
            );
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

export interface QQC2CStreamOptions {
    targetId: string;
    msgId: string;
    eventId?: string;
    throttleMs?: number;
}

function isStandardRequest(value: Request | QQHttpContext): value is Request {
    return (
        typeof (value as Request).method === "string" &&
        typeof (value as Request).arrayBuffer === "function"
    );
}

/** 识别官方 SDK 当前唯一的重连耗尽信号，避免把普通平台错误误判成生命周期事件。 */
export function isQQSdkReconnectExhaustedLog(message: string): boolean {
    return message.endsWith("Max reconnect attempts reached or aborted");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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
