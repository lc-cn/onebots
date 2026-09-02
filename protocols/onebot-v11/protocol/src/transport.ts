import type { Router } from "onebots";
import { emitAllAwaited, requireNonEmptyStringParam, ReverseWebSocketSession } from "onebots";
import crypto from "node:crypto";
import WebSocket from "ws";
import type { OneBotV11Config } from "./config.js";

type DispatchListener = (data: string) => void | Promise<void>;
type WebSocketRole = "api" | "event" | "universal";

interface TransportLogger {
    debug(message: unknown, ...args: unknown[]): void;
    error(message: unknown, ...args: unknown[]): void;
    info(message: unknown, ...args: unknown[]): void;
    warn(message: unknown, ...args: unknown[]): void;
}

export interface OneBotV11TransportContext {
    readonly accountId: string;
    readonly path: string;
    readonly config: OneBotV11Config.Config;
    readonly router: Router;
    readonly logger: TransportLogger;
    readonly apply: (
        action: string,
        params?: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    readonly format: (event: string, payload: Record<string, unknown>) => Record<string, unknown>;
    readonly onDispatch: (listener: DispatchListener) => void;
    readonly offDispatch: (listener: DispatchListener) => void;
    readonly dispatchEmitter: NodeJS.EventEmitter;
}

/** 统一管理 OneBot V11 的正向服务、反向投递和心跳生命周期。 */
export class OneBotV11Transport {
    private heartbeatTimer?: NodeJS.Timeout;
    private readonly cleanups = new Set<() => void>();

    constructor(private readonly context: OneBotV11TransportContext) {}

    start(): void {
        const { config } = this.context;
        if (config.use_http) this.startHttp();
        if (config.use_ws) this.startWebSocket();
        config.http_reverse?.forEach(url => this.startHttpReverse(url));
        config.ws_reverse?.forEach(url => this.startWebSocketReverse(url));
        if (config.use_ws || config.ws_reverse?.length) this.startHeartbeat();
    }

    stop(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        for (const cleanup of this.cleanups) cleanup();
        this.cleanups.clear();
    }

    private verifyToken(token?: string): boolean {
        return !this.context.config.access_token || token === this.context.config.access_token;
    }

    private startHttp(): void {
        const { context } = this;
        const routePath = `${context.path}/:action`;
        context.logger.info(`[OneBot V11] 注册 HTTP API：${routePath}`);
        context.router.post(routePath, async ctx => {
            const token =
                ctx.query.access_token || ctx.headers.authorization?.replace("Bearer ", "");
            if (!this.verifyToken(token as string)) {
                context.logger.warn(`[OneBot V11] Unauthorized request: ${ctx.path}`, {
                    token: token ? "present" : "missing",
                    expectedToken: context.config.access_token ? "configured" : "not configured",
                });
                ctx.status = 401;
                ctx.body = { status: "failed", retcode: 1403, msg: "Unauthorized" };
                return;
            }

            const action = ctx.params.action;
            const params = ((ctx.request as unknown as Record<string, unknown>).body ??
                {}) as Record<string, unknown>;
            context.logger.debug(`[OneBot V11] Processing action: ${action}`, params);
            try {
                ctx.body = await context.apply(action, params);
            } catch (error) {
                context.logger.error(`HTTP API ${action} failed:`, error);
                ctx.body = {
                    status: "failed",
                    retcode: -1,
                    msg: error instanceof Error ? error.message : String(error),
                };
            }
        });
    }

    private startWebSocket(): void {
        const { context } = this;
        this.registerWebSocketRoute(context.path, "universal");
        this.registerWebSocketRoute(`${context.path}/event`, "event");
        this.registerWebSocketRoute(`${context.path}/api`, "api");

        // Kovi 0.13.x 会先给 base path 补尾斜杠，再拼接 `/event` 与 `/api`。
        // 保留这两个精确别名，避免要求用户在框架外再部署一层路径改写代理。
        this.registerWebSocketRoute(`${context.path}//event`, "event");
        this.registerWebSocketRoute(`${context.path}//api`, "api");
    }

    private registerWebSocketRoute(path: string, role: WebSocketRole): void {
        const { context } = this;
        const server = context.router.ws(path);
        server.on("connection", (socket, request) => {
            const url = new URL(request.url ?? "/", "ws://localhost");
            const token =
                url.searchParams.get("access_token") ||
                request.headers.authorization?.replace("Bearer ", "");
            if (!this.verifyToken(token)) {
                socket.close(1008, "Unauthorized");
                return;
            }

            context.logger.info(`WebSocket client connected: ${path} (${role})`);
            const onDispatch: DispatchListener = data => {
                if (socket.readyState !== WebSocket.OPEN) return;
                socket.send(data);
            };
            if (role !== "api") {
                socket.send(
                    JSON.stringify(
                        context.format("meta_event", {
                            meta_event_type: "lifecycle",
                            sub_type: "connect",
                        }),
                    ),
                );
                context.onDispatch(onDispatch);
            }

            if (role !== "event") {
                socket.on("message", async data => {
                    try {
                        const request = JSON.parse(data.toString()) as Record<string, unknown>;
                        const action = requireNonEmptyStringParam(request, "action");
                        const params =
                            request.params && typeof request.params === "object"
                                ? (request.params as Record<string, unknown>)
                                : undefined;
                        const response = await context.apply(action, params);
                        socket.send(
                            JSON.stringify(
                                request.echo === undefined
                                    ? response
                                    : { ...response, echo: request.echo },
                            ),
                        );
                    } catch (error) {
                        context.logger.error("WebSocket message error:", error);
                        socket.send(
                            JSON.stringify({
                                status: "failed",
                                retcode: -1,
                                msg: error instanceof Error ? error.message : String(error),
                            }),
                        );
                    }
                });
            }
            socket.on("close", () => {
                if (role !== "api") context.offDispatch(onDispatch);
                context.logger.info(`WebSocket client disconnected: ${path} (${role})`);
            });
            socket.on("error", error => context.logger.error("WebSocket error:", error));
        });
        context.logger.info(`WebSocket ${role} server listening on ${path}`);
    }

    private startHeartbeat(): void {
        const { context } = this;
        if (!context.config.heartbeat_interval || this.heartbeatTimer) return;
        const intervalMs = Math.max(Number(context.config.heartbeat_interval) || 1, 1);
        this.heartbeatTimer = setInterval(() => {
            const heartbeat = context.format("meta_event", {
                meta_event_type: "heartbeat",
                status: { online: true, good: true },
                interval: intervalMs,
            });
            void emitAllAwaited(
                context.dispatchEmitter,
                "dispatch",
                JSON.stringify(heartbeat),
            ).catch(error => context.logger.error("OneBot V11 heartbeat dispatch failed:", error));
        }, intervalMs);
    }

    private startHttpReverse(url: string): void {
        const { context } = this;
        const onDispatch: DispatchListener = async data => {
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                "User-Agent": "OneBot/11",
                "X-Self-ID": context.accountId,
            };
            if (context.config.access_token) {
                headers.Authorization = `Bearer ${context.config.access_token}`;
            }
            if (context.config.secret) {
                headers["X-Signature"] =
                    "sha1=" +
                    crypto.createHmac("sha1", context.config.secret).update(data).digest("hex");
            }
            const response = await fetch(url, {
                method: "POST",
                headers,
                body: data,
                signal: AbortSignal.timeout(context.config.post_timeout || 5000),
            });
            if (!response.ok) {
                throw new Error(`HTTP POST failed: ${response.status} ${response.statusText}`);
            }
        };
        context.onDispatch(onDispatch);
        this.cleanups.add(() => context.offDispatch(onDispatch));
        context.logger.info(`HTTP reverse configured to POST events to ${url}`);
    }

    private startWebSocketReverse(url: string): void {
        const { context } = this;
        const endpoint = new URL(url);
        const headers: Record<string, string> = {
            "User-Agent": "OneBot/11",
            "X-Self-ID": context.accountId,
            "X-Client-Role": "Universal",
        };
        if (context.config.access_token) {
            endpoint.searchParams.set("access_token", context.config.access_token);
            headers.Authorization = `Bearer ${context.config.access_token}`;
        }
        const session = new ReverseWebSocketSession({
            url: endpoint.toString(),
            headers,
            logger: context.logger,
            onOpen: () => {
                session.send(
                    JSON.stringify(
                        context.format("meta_event", {
                            meta_event_type: "lifecycle",
                            sub_type: "connect",
                        }),
                    ),
                );
            },
            onMessage: async data => {
                const request = JSON.parse(data.toString()) as Record<string, unknown>;
                const action = requireNonEmptyStringParam(request, "action");
                const params =
                    request.params && typeof request.params === "object"
                        ? (request.params as Record<string, unknown>)
                        : undefined;
                const result = await context.apply(action, params);
                session.send(
                    JSON.stringify(
                        request.echo === undefined ? result : { ...result, echo: request.echo },
                    ),
                );
            },
        });
        const onDispatch: DispatchListener = data => session.send(data);
        const cleanup = () => {
            context.offDispatch(onDispatch);
            session.stop();
        };
        context.onDispatch(onDispatch);
        this.cleanups.add(cleanup);
        session.start();
    }
}
