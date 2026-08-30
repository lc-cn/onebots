import { requireNonEmptyStringParam, ReverseWebSocketSession, type Router } from "onebots";
import { WebSocket } from "ws";
import type { OneBotV12Config } from "./config.js";
import type { OneBotV12 } from "./types.js";

type DispatchListener = (data: string) => void | Promise<void>;

interface TransportLogger {
    error(message: unknown, ...args: unknown[]): void;
    info(message: unknown, ...args: unknown[]): void;
    warn(message: unknown, ...args: unknown[]): void;
}

export interface OneBotV12TransportContext {
    readonly path: string;
    readonly config: OneBotV12Config.Config;
    readonly router: Router;
    readonly logger: TransportLogger;
    readonly apply: (
        action: string,
        params?: Record<string, unknown>,
    ) => Promise<OneBotV12.Response>;
    readonly getVersionInfo: () => Promise<OneBotV12.VersionInfo>;
    readonly dispatchMetaEvent: (detailType: string, extra?: Record<string, unknown>) => void;
    readonly onDispatch: (listener: DispatchListener) => void;
    readonly offDispatch: (listener: DispatchListener) => void;
}

/** 管理 OneBot V12 的 HTTP、WebSocket 与反向投递资源。 */
export class OneBotV12Transport {
    private readonly cleanups = new Set<() => void>();

    constructor(private readonly context: OneBotV12TransportContext) {}

    start(): void {
        const { config } = this.context;
        if (config.use_http) this.startHttp();
        if (config.use_ws) this.startWebSocket();
        config.http_webhook?.forEach(url => this.startHttpWebhook(url));
        config.ws_reverse?.forEach(url => this.startWebSocketReverse(url));
    }

    stop(): void {
        for (const cleanup of this.cleanups) cleanup();
        this.cleanups.clear();
    }

    private verifyToken(token?: string): boolean {
        return !this.context.config.access_token || token === this.context.config.access_token;
    }

    private startHttp(): void {
        const { context } = this;
        const routePath = `${context.path}/:action`;
        context.router.post(routePath, async ctx => {
            const authorization = ctx.headers.authorization;
            const token =
                (typeof authorization === "string"
                    ? authorization.replace(/^Bearer\s+/i, "").trim()
                    : undefined) || ctx.query.access_token;
            if (!this.verifyToken(token as string)) {
                ctx.status = 401;
                ctx.body = {
                    status: "failed",
                    retcode: 1403,
                    message: "Unauthorized",
                    data: null,
                };
                return;
            }

            const action = ctx.params.action;
            const params = ((ctx.request as unknown as Record<string, unknown>).body ??
                {}) as Record<string, unknown>;
            try {
                ctx.body = await context.apply(action, params);
            } catch (error) {
                context.logger.error(`HTTP API ${action} failed:`, error);
                ctx.body = {
                    status: "failed",
                    retcode: -1,
                    message: error instanceof Error ? error.message : String(error),
                    data: null,
                };
            }
        });
        context.logger.info(`HTTP server listening on ${routePath}`);
    }

    private startWebSocket(): void {
        const { context } = this;
        const server = context.router.ws(context.path);
        server.on("connection", (socket, request) => {
            const authorization = request.headers.authorization;
            const url = new URL(request.url ?? "/", "ws://localhost");
            const token =
                (typeof authorization === "string"
                    ? authorization.replace(/^Bearer\s+/i, "").trim()
                    : undefined) || url.searchParams.get("access_token");
            if (!this.verifyToken(token)) {
                socket.close(1008, "Unauthorized");
                return;
            }

            context.logger.info(`WebSocket client connected: ${context.path}`);
            const onDispatch: DispatchListener = data => {
                if (socket.readyState === WebSocket.OPEN) socket.send(data);
            };
            context.onDispatch(onDispatch);
            void context
                .getVersionInfo()
                .then(version => context.dispatchMetaEvent("connect", { version }))
                .catch(error => context.logger.error("OneBot V12 version query failed:", error));

            socket.on("message", async data => {
                try {
                    const request = JSON.parse(data.toString()) as Record<string, unknown>;
                    const action = requireNonEmptyStringParam(request, "action");
                    const params =
                        request.params && typeof request.params === "object"
                            ? (request.params as Record<string, unknown>)
                            : undefined;
                    const result = await context.apply(action, params);
                    socket.send(
                        JSON.stringify(
                            request.echo === undefined ? result : { ...result, echo: request.echo },
                        ),
                    );
                } catch (error) {
                    context.logger.error("WebSocket message error:", error);
                    socket.send(
                        JSON.stringify({
                            status: "failed",
                            retcode: -1,
                            message: error instanceof Error ? error.message : String(error),
                            data: null,
                        }),
                    );
                }
            });
            socket.on("close", () => {
                context.offDispatch(onDispatch);
                context.logger.info(`WebSocket client disconnected: ${context.path}`);
            });
            socket.on("error", error => context.logger.error("WebSocket error:", error));
        });
        context.logger.info(`WebSocket server listening on ${context.path}`);
    }

    private startHttpWebhook(url: string): void {
        const { context } = this;
        const onDispatch: DispatchListener = async data => {
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                "User-Agent": "OneBot/12",
                "X-OneBot-Version": "12",
                "X-Impl": "onebots",
            };
            if (context.config.access_token) {
                headers.Authorization = `Bearer ${context.config.access_token}`;
            }
            const response = await fetch(url, {
                method: "POST",
                headers,
                body: data,
                signal: AbortSignal.timeout(context.config.request_timeout || 15000),
            });
            if (!response.ok) {
                throw new Error(
                    `HTTP webhook POST failed: ${response.status} ${response.statusText}`,
                );
            }
        };
        context.onDispatch(onDispatch);
        this.cleanups.add(() => context.offDispatch(onDispatch));
        context.logger.info(`HTTP webhook configured to POST events to ${url}`);
    }

    private startWebSocketReverse(url: string): void {
        const { context } = this;
        const endpoint = new URL(url);
        if (context.config.access_token) {
            endpoint.searchParams.set("access_token", context.config.access_token);
        }
        const session = new ReverseWebSocketSession({
            url: endpoint.toString(),
            headers: {
                "User-Agent": "OneBot/12",
                "X-OneBot-Version": "12",
                "X-Impl": "onebots",
            },
            logger: context.logger,
            onOpen: () => {
                void context
                    .getVersionInfo()
                    .then(version => context.dispatchMetaEvent("connect", { version }))
                    .catch(error =>
                        context.logger.error("OneBot V12 reverse version query failed:", error),
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
