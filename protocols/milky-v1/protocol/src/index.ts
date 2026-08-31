import {
    emitAllAwaited,
    Protocol,
    ProtocolRegistry,
    Account,
    Adapter,
    requireNonEmptyStringParam,
    ReverseWebSocketSession,
} from "onebots";
import type { CommonEvent, Schema } from "onebots";
import { Milky } from "./types.js";
import { MilkyConfig } from "./config.js";
import { WebSocket } from "ws";
import { projectMilkyEvent } from "./event-projector.js";
import { executeMilkyAccountAction, MILKY_ACCOUNT_ACTIONS } from "./account-actions.js";
import { executeMilkyGroupAction, MILKY_GROUP_ACTIONS } from "./group-actions.js";
import {
    executeMilkyGroupRequestAction,
    getMilkyGroupNotifications,
    MILKY_GROUP_REQUEST_ACTIONS,
} from "./group-requests.js";
import {
    executeMilkyFriendRequestAction,
    getMilkyFriendRequests,
    MILKY_FRIEND_REQUEST_ACTIONS,
} from "./friend-requests.js";
import { isMilkyAction } from "./action-registry.js";
import { MilkyActionNotFoundError, toMilkyFailure } from "./api-errors.js";
import { executeMilkyFileAction, MILKY_FILE_ACTIONS } from "./file-actions.js";
import { executeMilkyMessageAction, MILKY_MESSAGE_ACTIONS } from "./message-actions.js";
import { executeMilkyDirectoryAction, MILKY_DIRECTORY_ACTIONS } from "./directory-actions.js";
import { createMilkySignature, verifyMilkyToken } from "./auth.js";

const milkySchema: Schema = {
    use_http: { type: "boolean", label: "启用 HTTP", ui: { section: "transport" } },
    use_ws: { type: "boolean", label: "启用 WebSocket", ui: { section: "transport" } },
    http_reverse: {
        type: "array",
        default: [],
        label: "HTTP 反向上报",
        description: "将事件 POST 到下游服务。展开单项可覆盖鉴权与超时。",
        ui: {
            widget: "endpoint-list",
            section: "delivery",
            itemLabel: "Webhook",
            addLabel: "添加 Webhook",
            schemes: ["http:", "https:"],
            fields: [
                {
                    key: "access_token",
                    label: "Access Token",
                    sensitive: true,
                    placeholder: "留空则使用全局 Token",
                },
                {
                    key: "secret",
                    label: "签名 Secret",
                    sensitive: true,
                    placeholder: "留空则使用全局 Secret",
                },
                {
                    key: "post_timeout",
                    label: "超时（秒）",
                    type: "number",
                    placeholder: "例如 15",
                },
            ],
        },
    },
    ws_reverse: {
        type: "array",
        default: [],
        label: "反向 WebSocket",
        description: "由 OneBots 主动连接下游服务。展开单项可覆盖鉴权与重连间隔。",
        ui: {
            widget: "endpoint-list",
            section: "delivery",
            itemLabel: "连接",
            addLabel: "添加连接",
            schemes: ["ws:", "wss:"],
            fields: [
                {
                    key: "access_token",
                    label: "Access Token",
                    sensitive: true,
                    placeholder: "留空则使用全局 Token",
                },
                {
                    key: "reconnect_interval",
                    label: "重连间隔（秒）",
                    type: "number",
                    placeholder: "例如 5",
                },
            ],
        },
    },
    access_token: {
        type: "string",
        label: "Access Token",
        sensitive: true,
        ui: { section: "credentials" },
    },
    secret: {
        type: "string",
        label: "Secret",
        sensitive: true,
        ui: { section: "credentials" },
    },
    filters: Protocol.FilterSchema,
};

ProtocolRegistry.registerSchema("milky.v1", milkySchema);

/**
 * Milky Protocol V1 Implementation
 * Milky is a QQ bot protocol similar to OneBot but with different message formats
 * Reference: https://milky.ntqqrev.org/
 */
export class MilkyV1 extends Protocol<"v1", MilkyConfig.Config> {
    public readonly name = "milky";
    public readonly version = "v1" as const;
    private readonly reverseWebSocketCleanups = new Set<() => void>();

    constructor(
        public adapter: Adapter,
        public account: Account,
        config: Protocol.Config,
    ) {
        super(adapter, account, {
            ...config,
            protocol: "milky",
            version: "v1",
        });
    }

    start(): void {
        // Initialize Milky protocol services
        if (this.config.use_http) {
            this.startHttp();
        }
        if (this.config.use_ws) {
            this.startWs();
        }
        if (this.config.http_reverse) {
            this.config.http_reverse.forEach(cfg => {
                const config = typeof cfg === "string" ? { url: cfg } : cfg;
                this.startHttpReverse(config);
            });
        }
        if (this.config.ws_reverse) {
            this.config.ws_reverse.forEach(cfg => {
                const config = typeof cfg === "string" ? { url: cfg } : cfg;
                this.startWsReverse(config);
            });
        }
    }

    async stop(_force?: boolean): Promise<void> {
        this.logger.info(`Stopping Milky protocol v1`);
        for (const cleanup of this.reverseWebSocketCleanups) cleanup();
        this.reverseWebSocketCleanups.clear();
        this.removeAllListeners();
    }

    /**
     * 上报事件到 Milky 客户端（HTTP 反连 / WebSocket 等）。
     * Account.dispatch 传入的是 CommonEvent；内部调用也可以传入已构造的 Milky event_type 事件。
     */
    async dispatch(event: unknown): Promise<void> {
        if (!this.filterFn(event as Record<string, unknown>)) {
            return;
        }
        let milkyEvent: Milky.Event | null = null;
        if (this.isMilkyShapedEvent(event)) {
            milkyEvent = event;
        } else {
            milkyEvent = projectMilkyEvent(event as CommonEvent.Event);
        }
        if (milkyEvent) {
            this.logger.debug(`Milky dispatch:`, milkyEvent);
            await emitAllAwaited(this, "dispatch", JSON.stringify(milkyEvent));
        } else {
            const commonEvent = event as Partial<CommonEvent.Event>;
            const description = `Milky 无法表示事件，已跳过: type=${commonEvent.type || "unknown"}`;
            if (commonEvent.type === "notice") {
                this.logger.warn(
                    description,
                    `notice_type=${(commonEvent as Partial<CommonEvent.Notice>).notice_type || "unknown"}`,
                );
            } else {
                this.logger.debug(description);
            }
        }
    }

    /** 协议内部构造的事件（event_type）无需从 CommonEvent 转换 */
    private isMilkyShapedEvent(e: unknown): e is Milky.Event {
        return (
            typeof e === "object" &&
            e !== null &&
            "event_type" in e &&
            typeof (e as { event_type: unknown }).event_type === "string"
        );
    }

    /**
     * 与 dispatch 相同，便于阅读；Account 只调用各协议的 dispatch(CommonEvent)
     */
    async dispatchCommonEvent(commonEvent: CommonEvent.Event): Promise<void> {
        await this.dispatch(commonEvent);
    }

    format(event: string, payload: Record<string, unknown>): Record<string, unknown> {
        return {
            time: Math.floor(Date.now() / 1000),
            self_id: Number(this.account.account_id) || 0,
            event_type: event,
            data: payload,
        };
    }

    async apply(action: string, params?: Record<string, unknown>): Promise<Milky.Response> {
        // Execute Milky API action
        this.logger.debug(`Milky action: ${action}`, params);

        try {
            const result = await this.executeAction(action, params);
            return {
                status: "ok",
                retcode: 0,
                data: result,
            };
        } catch (error) {
            this.logger.error(`Milky action ${action} failed:`, error);
            return toMilkyFailure(error);
        }
    }

    /**
     * Execute Milky action
     */
    private async executeAction(
        action: string,
        params: Record<string, unknown> = {},
    ): Promise<unknown> {
        if (!this.isKnownAction(action)) throw new MilkyActionNotFoundError(action);
        if (MILKY_ACCOUNT_ACTIONS.has(action)) {
            return executeMilkyAccountAction(this.adapter, this.account.account_id, action, params);
        }
        if (MILKY_GROUP_ACTIONS.has(action)) {
            return executeMilkyGroupAction(this.adapter, this.account.account_id, action, params);
        }
        if (MILKY_GROUP_REQUEST_ACTIONS.has(action)) {
            return executeMilkyGroupRequestAction(
                this.adapter,
                this.account.account_id,
                action,
                params,
            );
        }
        if (MILKY_FRIEND_REQUEST_ACTIONS.has(action)) {
            return executeMilkyFriendRequestAction(
                this.adapter,
                this.account.account_id,
                action,
                params,
            );
        }
        if (MILKY_FILE_ACTIONS.has(action)) {
            return executeMilkyFileAction(this.adapter, this.account.account_id, action, params);
        }
        if (MILKY_MESSAGE_ACTIONS.has(action)) {
            return executeMilkyMessageAction(this.adapter, this.account.account_id, action, params);
        }
        if (MILKY_DIRECTORY_ACTIONS.has(action)) {
            return executeMilkyDirectoryAction(
                this.adapter,
                this.account.account_id,
                action,
                params,
            );
        }
        switch (action) {
            case "get_friend_requests":
                return getMilkyFriendRequests(this.adapter, this.account.account_id, params);
            case "get_group_notifications":
                return getMilkyGroupNotifications(this.adapter, this.account.account_id, params);
            default:
                if (
                    typeof this.adapter.describeCapabilities === "function" &&
                    this.adapter.describeCapabilities(this.account.account_id).actions[action]
                ) {
                    return this.adapter.callAction(this.account.account_id, action, params);
                }
                throw new MilkyActionNotFoundError(action);
        }
    }

    private isKnownAction(action: string): boolean {
        if (isMilkyAction(action)) return true;
        return Boolean(this.adapter.describeCapabilities(this.account.account_id).actions[action]);
    }

    // Service implementations
    private startHttp(): void {
        this.logger.info("Starting Milky HTTP server");

        // Register HTTP POST endpoint for API calls
        this.router.post(`${this.path}/api/:action`, async ctx => {
            // Milky 通信规范：不支持的 Content-Type 返回 415
            const contentType = ctx.headers["content-type"] || "";
            if (!contentType.toLowerCase().includes("application/json")) {
                ctx.status = 415;
                return;
            }
            // Verify access token（Authorization: Bearer 优先，再 Query）
            const authHeader = ctx.headers.authorization;
            const token =
                (typeof authHeader === "string"
                    ? authHeader.replace(/^Bearer\s+/i, "").trim()
                    : undefined) || ctx.query.access_token;
            if (!verifyMilkyToken(this.config.access_token, token as string)) {
                ctx.status = 401;
                ctx.body = { status: "failed", retcode: 1403, message: "Unauthorized" };
                return;
            }

            const action = ctx.params.action;
            const params = ((ctx.request as unknown as Record<string, unknown>).body ??
                {}) as Record<string, unknown>;

            if (!this.isKnownAction(action)) {
                ctx.status = 404;
                ctx.body = toMilkyFailure(new MilkyActionNotFoundError(action));
                return;
            }

            try {
                const result = await this.apply(action, params);
                ctx.body = result;
            } catch (error) {
                this.logger.error(`HTTP API ${action} failed:`, error);
                ctx.body = {
                    status: "failed",
                    retcode: -1,
                    message: error.message,
                };
            }
        });

        this.logger.info(`Milky HTTP server listening on ${this.path}/api/:action`);
    }

    private startWs(): void {
        this.logger.info("Starting Milky WebSocket server");

        const wss = this.router.ws(this.path + "/event");

        wss.on("connection", (ws, request) => {
            // Verify access token
            const url = new URL(request.url!, `ws://localhost`);
            const token =
                url.searchParams.get("access_token") ||
                request.headers.authorization?.replace("Bearer ", "");

            if (!verifyMilkyToken(this.config.access_token, token as string)) {
                ws.close(1008, "Unauthorized");
                return;
            }

            this.logger.info(`Milky WebSocket client connected: ${this.path}`);

            // Listen for dispatch events and send to client
            const onDispatch = (data: string) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(data);
                }
            };
            this.on("dispatch", onDispatch);

            // Handle incoming API calls
            ws.on("message", async data => {
                try {
                    const request = JSON.parse(data.toString());
                    const { action, params, echo } = request;

                    const result = await this.apply(action, params);
                    ws.send(JSON.stringify({ ...result, echo }));
                } catch (error) {
                    this.logger.error("WebSocket message error:", error);
                    ws.send(
                        JSON.stringify({
                            status: "failed",
                            retcode: -1,
                            message: error.message,
                        }),
                    );
                }
            });

            ws.on("close", () => {
                this.logger.info(`Milky WebSocket client disconnected: ${this.path}`);
                this.off("dispatch", onDispatch);
            });

            ws.on("error", error => {
                this.logger.error("WebSocket error:", error);
            });
        });

        this.logger.info(`Milky WebSocket server listening on ${this.path}`);
    }

    private startHttpReverse(config: MilkyConfig.HttpReverseConfig): void {
        this.logger.info(`Starting Milky HTTP reverse: ${config.url}`);

        // Listen for dispatch events and POST to external server
        const onDispatch = async (data: string) => {
            try {
                const headers: Record<string, string> = {
                    "Content-Type": "application/json",
                    "User-Agent": "Milky/1.0",
                    "X-Self-ID": this.account.account_id,
                };

                // Add access token if configured
                const token = config.access_token || this.config.access_token;
                if (token) {
                    headers["Authorization"] = `Bearer ${token}`;
                }

                // Add signature if secret is configured
                const secret = config.secret || this.config.secret;
                if (secret) {
                    headers["X-Signature"] = createMilkySignature(secret, data);
                }

                const response = await fetch(config.url, {
                    method: "POST",
                    headers,
                    body: data,
                    signal: AbortSignal.timeout((config.post_timeout || 5) * 1000),
                });

                if (!response.ok)
                    throw new Error(`HTTP POST failed: ${response.status} ${response.statusText}`);
            } catch (error) {
                this.logger.error(`HTTP POST error:`, error);
                throw error;
            }
        };

        this.on("dispatch", onDispatch);
        this.logger.info(`Milky HTTP reverse configured to POST events to ${config.url}`);
    }

    private startWsReverse(config: MilkyConfig.WsReverseConfig): void {
        this.logger.info(`Starting Milky WebSocket reverse: ${config.url}`);
        const wsUrl = new URL(config.url);
        const token = config.access_token || this.config.access_token;
        if (token) {
            wsUrl.searchParams.set("access_token", token);
        }
        const session = new ReverseWebSocketSession({
            url: wsUrl.toString(),
            headers: {
                "User-Agent": "Milky/1.0",
                "X-Self-ID": this.account.account_id,
                "X-Client-Role": "Universal",
            },
            logger: this.logger,
            reconnectDelayMs: (config.reconnect_interval || 5) * 1_000,
            onMessage: async data => {
                const request = JSON.parse(data.toString()) as Record<string, unknown>;
                const action = requireNonEmptyStringParam(request, "action");
                const params =
                    request.params && typeof request.params === "object"
                        ? (request.params as Record<string, unknown>)
                        : undefined;
                const result = await this.apply(action, params);
                const response =
                    request.echo !== undefined ? { ...result, echo: request.echo } : result;
                session.send(JSON.stringify(response));
            },
        });
        const onDispatch = (data: string) => session.send(data);
        const cleanup = () => {
            this.off("dispatch", onDispatch);
            session.stop();
        };
        this.on("dispatch", onDispatch);
        this.reverseWebSocketCleanups.add(cleanup);
        session.start();
    }
}

ProtocolRegistry.register("milky", "v1", MilkyV1);
export * from "./types.js";
export * from "./config.js";
