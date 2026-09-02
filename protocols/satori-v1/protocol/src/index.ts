import { emitAllAwaited, Protocol, ProtocolRegistry } from "onebots";
import type { Dict, Schema } from "onebots";
import { Account } from "onebots";
import { Adapter } from "onebots";
import { CommonEvent, CommonTypes } from "onebots";
import { WebSocket } from "ws";
import { SatoriActionService } from "./actions.js";
import { SatoriChannelRouteRegistry } from "./channel-routes.js";
import { projectSatoriNotice } from "./notice-projector.js";
import { Satori } from "./types.js";
import { SatoriConfig } from "./config.js";

const satoriSchema: Schema = {
    use_http: { type: "boolean", label: "启用 HTTP", ui: { section: "transport" } },
    use_ws: { type: "boolean", label: "启用 WebSocket", ui: { section: "transport" } },
    webhooks: {
        type: "array",
        default: [],
        label: "Webhook",
        description: "将事件推送到下游 HTTP 服务。展开单项可覆盖 Token。",
        ui: {
            widget: "endpoint-list",
            section: "delivery",
            itemLabel: "Webhook",
            addLabel: "添加 Webhook",
            schemes: ["http:", "https:"],
            fields: [
                {
                    key: "token",
                    label: "Token",
                    sensitive: true,
                    placeholder: "留空则使用全局 Token",
                },
            ],
        },
    },
    token: {
        type: "string",
        label: "Token",
        sensitive: true,
        ui: { section: "credentials" },
    },
    platform: {
        type: "string",
        label: "平台标识覆盖",
        description: "留空时继承来源适配器的平台标识；仅在下游需要自定义命名空间时填写。",
        ui: { section: "advanced" },
    },
    filters: Protocol.FilterSchema,
};

ProtocolRegistry.registerSchema("satori.v1", satoriSchema);

/**
 * Satori Protocol V1 Implementation
 * Satori is a cross-platform chatbot protocol
 * Reference: https://github.com/satorijs/satori
 */
export class SatoriV1 extends Protocol<"v1", SatoriConfig.Config> {
    public readonly name = "satori";
    public readonly version = "v1" as const;
    private eventId = 0;
    private readonly actions: SatoriActionService;
    private readonly channelRoutes: SatoriChannelRouteRegistry;
    private readonly webhookCleanups = new Set<() => void>();

    constructor(
        public adapter: Adapter,
        public account: Account,
        config: SatoriConfig.Config,
    ) {
        super(adapter, account, {
            ...config,
            protocol: "satori",
            version: "v1",
        });
        this.channelRoutes = new SatoriChannelRouteRegistry(adapter, account.account_id);
        this.actions = new SatoriActionService(
            adapter,
            account,
            segments => this.convertMessageContent(segments),
            this.channelRoutes,
        );
    }

    start(): void {
        // Initialize Satori protocol services
        if (this.config.use_http) {
            this.startHttp();
        }
        if (this.config.use_ws) {
            this.startWs();
        }
        if (this.config.webhooks) {
            this.config.webhooks.forEach(cfg => {
                const config = typeof cfg === "string" ? { url: cfg } : cfg;
                this.startWebhook(config);
            });
        }
    }

    async stop(_force?: boolean): Promise<void> {
        this.logger.info(`Stopping Satori protocol v1`);
        for (const cleanup of this.webhookCleanups) cleanup();
        this.webhookCleanups.clear();
        this.removeAllListeners();
    }

    /**
     * Account.dispatch 传入 CommonEvent；dispatchCommonEvent 等会传入已构造的 Satori.Event
     */
    async dispatch(event: unknown): Promise<void> {
        if (!this.isCommonEventShape(event)) {
            throw new TypeError("SatoriV1.dispatch 只接受 CommonEvent");
        }
        if (!this.filterFn(event as Dict)) return;
        const satoriEvent = this.convertToSatoriFormat(event);
        if (satoriEvent) {
            this.logger.debug(`Satori dispatch:`, satoriEvent);
            await emitAllAwaited(this, "dispatch", JSON.stringify(satoriEvent));
        }
    }

    private isCommonEventShape(e: unknown): e is CommonEvent.Event {
        if (typeof e !== "object" || e === null) return false;
        const t = (e as { type?: string }).type;
        return t === "message" || t === "notice" || t === "request" || t === "meta";
    }

    async dispatchCommonEvent(commonEvent: CommonEvent.Event): Promise<void> {
        await this.dispatch(commonEvent);
    }

    format(event: string, payload: Record<string, unknown>): Record<string, unknown> {
        // Format event according to Satori specification
        return {
            type: event,
            ...payload,
        };
    }

    async apply(action: string, params?: Record<string, unknown>): Promise<Satori.Response> {
        // Execute Satori API action
        this.logger.debug(`Satori action: ${action}`, params);

        try {
            const result = await this.actions.execute(action, params);
            return {
                data: result,
            };
        } catch (error) {
            this.logger.error(`Satori action ${action} failed:`, error);
            return {
                message: error.message,
            };
        }
    }

    /**
     * Convert CommonEvent to Satori-specific format
     */
    private convertToSatoriFormat(event: CommonEvent.Event): Satori.Event | null {
        switch (event.type) {
            case "message":
                return this.formatSatoriMessage(event);
            case "notice":
                return this.formatSatoriNotice(event);
            case "request":
                return this.formatSatoriRequest(event);
            case "meta":
                return this.formatSatoriMeta(event);
            default:
                return null;
        }
    }

    private formatSatoriMessage(event: CommonEvent.Message): Satori.Event {
        const route = this.channelRoutes.rememberEvent(event);
        return {
            id: this.eventId++,
            type: "message-created",
            platform: this.config.platform || event.platform,
            self_id: this.adapter.resolveId(this.account.account_id).string,
            timestamp: event.timestamp,
            channel: {
                id:
                    event.group?.channel_id?.string ??
                    event.group?.id.string ??
                    event.sender.id.string,
                type: route.scene_type === "private" || route.scene_type === "direct" ? 1 : 0,
                name: event.group?.name,
            },
            guild: event.group?.guild_id
                ? { id: event.group.guild_id.string }
                : event.message_type === "group" && event.group
                  ? { id: event.group.id.string, name: event.group.name }
                  : undefined,
            user: {
                id: event.sender.id.string,
                name: event.sender.name,
                avatar: event.sender.avatar,
            },
            message: {
                id: event.message_id.string,
                content: this.convertMessageContent(event.message),
                created_at: event.timestamp,
            },
        };
    }

    private formatSatoriNotice(event: CommonEvent.Notice): Satori.Event {
        return projectSatoriNotice(event, {
            id: this.eventId++,
            platform: this.config.platform || event.platform,
            selfId: this.adapter.resolveId(this.account.account_id).string,
            convertMessageContent: segments => this.convertMessageContent(segments ?? []),
        });
    }

    private formatSatoriRequest(event: CommonEvent.Request): Satori.Event {
        return {
            id: this.eventId++,
            type: event.request_type === "friend" ? "friend-request" : "guild-member-request",
            platform: this.config.platform || event.platform,
            self_id: this.adapter.resolveId(this.account.account_id).string,
            timestamp: event.timestamp,
            user: {
                id: event.user.id.string,
                name: event.user.name,
            },
        };
    }

    private formatSatoriMeta(event: CommonEvent.Meta): Satori.Event {
        return {
            id: this.eventId++,
            type: "internal",
            platform: this.config.platform || event.platform,
            self_id: this.adapter.resolveId(this.account.account_id).string,
            timestamp: event.timestamp,
        };
    }

    /**
     * Convert CommonEvent message segments to Satori message content
     */
    private convertMessageContent(segments: CommonTypes.Segment[]): string {
        return segments
            .map(seg => {
                if (seg.type === "text") {
                    return seg.data.text || "";
                }
                // Convert other segment types to Satori elements
                const attrs = Object.entries(seg.data)
                    .map(([k, v]) => `${k}="${v}"`)
                    .join(" ");
                return `<${seg.type} ${attrs} />`;
            })
            .join("");
    }

    /**
     * Verify access token
     */
    private verifyToken(token?: string): boolean {
        const requiredToken = this.config.token;
        if (!requiredToken) return true;
        return token === requiredToken;
    }

    // Service implementations
    private startHttp(): void {
        this.logger.info("Starting Satori HTTP server");

        // Register HTTP POST endpoint for API calls
        this.router.post(`${this.path}/:method`, async ctx => {
            // Verify access token
            const authHeader = ctx.headers["authorization"];
            const token =
                typeof authHeader === "string"
                    ? authHeader.replace(/^Bearer\s+/i, "").trim()
                    : undefined;

            if (!this.verifyToken(token)) {
                ctx.status = 401;
                ctx.body = { message: "Unauthorized" };
                return;
            }

            const method = ctx.params.method;
            const params = ((ctx.request as unknown as Record<string, unknown>).body ??
                {}) as Record<string, unknown>;

            try {
                const result = await this.apply(method, params);
                const isOfficialAdapter = Boolean(
                    ctx.headers["satori-platform"] || ctx.headers["x-platform"],
                );
                ctx.body = isOfficialAdapter && "data" in result ? result.data : result;
            } catch (error) {
                this.logger.error(`HTTP API ${method} failed:`, error);
                ctx.status = 500;
                ctx.body = {
                    message: error.message,
                };
            }
        });

        // GET /v1/login for login info
        this.router.get(`${this.path}/login`, async ctx => {
            // Verify access token
            const authHeader = ctx.headers["authorization"];
            const token =
                typeof authHeader === "string" ? authHeader.replace("Bearer ", "") : undefined;
            if (!this.verifyToken(token)) {
                ctx.status = 401;
                ctx.body = { message: "Unauthorized" };
                return;
            }

            try {
                const login = await this.actions.getLogin();
                ctx.body = login;
            } catch (error) {
                this.logger.error("Get login failed:", error);
                ctx.status = 500;
                ctx.body = { message: error.message };
            }
        });

        this.logger.info(`Satori HTTP server listening on ${this.path}`);
    }

    private startWs(): void {
        this.logger.info("Starting Satori WebSocket server");

        const wss = this.router.ws(`${this.path}/events`);

        wss.on("connection", ws => {
            this.logger.info(`Satori WebSocket client connected: ${this.path}/events`);
            let identified = false;

            // Listen for dispatch events and send to client
            const onDispatch = (data: string) => {
                if (identified && ws.readyState === WebSocket.OPEN) {
                    const event = JSON.parse(data);
                    const eventPayload = {
                        op: 0, // EVENT
                        body: event,
                    };
                    ws.send(JSON.stringify(eventPayload));
                }
            };
            this.on("dispatch", onDispatch);

            // Handle incoming messages (e.g., PING)
            ws.on("message", async data => {
                try {
                    const message = JSON.parse(data.toString());

                    if (message.op === 3) {
                        // IDENTIFY
                        const token = message.body?.token;
                        if (!this.verifyToken(typeof token === "string" ? token : undefined)) {
                            ws.close(1008, "Unauthorized");
                            return;
                        }
                        identified = true;
                        const login = await this.actions.getLogin();
                        ws.send(
                            JSON.stringify({
                                op: 4, // READY
                                body: {
                                    logins: [login],
                                    proxy_urls: [],
                                },
                            }),
                        );
                    } else if (message.op === 1) {
                        // PING
                        // Respond with PONG
                        ws.send(JSON.stringify({ op: 2 })); // PONG
                    }
                } catch (error) {
                    this.logger.error("WebSocket message error:", error);
                }
            });

            ws.on("close", () => {
                this.logger.info(`Satori WebSocket client disconnected: ${this.path}/events`);
                this.off("dispatch", onDispatch);
            });

            ws.on("error", error => {
                this.logger.error("WebSocket error:", error);
            });
        });

        this.logger.info(`Satori WebSocket server listening on ${this.path}/events`);
    }

    private startWebhook(config: SatoriConfig.WebhookConfig): void {
        this.logger.info(`Starting Satori webhook: ${config.url}`);

        // Listen for dispatch events and POST to external server
        const onDispatch = async (data: string) => {
            try {
                const headers: Record<string, string> = {
                    "Content-Type": "application/json",
                    "User-Agent": "Satori/1.0",
                    "X-Platform": String(this.config.platform || this.account.platform),
                    "X-Self-ID": String(this.account.account_id),
                };

                // Add access token if configured
                const token = config.token || this.config.token;
                if (token) {
                    headers["Authorization"] = `Bearer ${token}`;
                }

                const response = await fetch(config.url, {
                    method: "POST",
                    headers,
                    body: data,
                    signal: AbortSignal.timeout(15000),
                });

                if (!response.ok)
                    throw new Error(
                        `Webhook POST failed: ${response.status} ${response.statusText}`,
                    );
            } catch (error) {
                this.logger.error(`Webhook POST error:`, error);
                throw error;
            }
        };

        this.on("dispatch", onDispatch);
        this.webhookCleanups.add(() => this.off("dispatch", onDispatch));
        this.logger.info(`Satori webhook configured to POST events to ${config.url}`);
    }
}

ProtocolRegistry.register("satori", "v1", SatoriV1);
export * from "./types.js";
export * from "./config.js";
