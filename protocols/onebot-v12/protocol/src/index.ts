import { emitAllAwaited, Protocol, ProtocolRegistry } from "onebots";
import type { Schema } from "onebots";
import { Account } from "onebots";
import { Adapter } from "onebots";
import { CommonEvent, CommonTypes } from "onebots";
import { OneBotV12 } from "./types.js";
import { OneBotV12Config } from "./config.js";
import { OneBotV12ActionService } from "./actions.js";
import { projectOneBotV12Notice } from "./notice-projector.js";
import { OneBotV12Transport } from "./transport.js";

const onebotV12Schema: Schema = {
    use_http: { type: "boolean", default: true, label: "启用 HTTP", ui: { section: "transport" } },
    use_ws: {
        type: "boolean",
        default: false,
        label: "启用 WebSocket",
        ui: { section: "transport" },
    },
    http_webhook: {
        type: "array",
        default: [],
        label: "HTTP Webhook",
        description: "将事件 POST 到已有的 HTTP 服务，可配置多个目标。",
        ui: {
            widget: "endpoint-list",
            section: "delivery",
            itemLabel: "Webhook",
            addLabel: "添加 Webhook",
            schemes: ["http:", "https:"],
        },
    },
    ws_reverse: {
        type: "array",
        default: [],
        label: "反向 WebSocket",
        description: "由 OneBots 主动连接下游 WebSocket 服务，可配置多个目标。",
        ui: {
            widget: "endpoint-list",
            section: "delivery",
            itemLabel: "连接",
            addLabel: "添加连接",
            schemes: ["ws:", "wss:"],
        },
    },
    request_timeout: {
        type: "number",
        label: "请求超时(秒)",
        ui: { section: "advanced" },
    },
    access_token: {
        type: "string",
        label: "Access Token",
        sensitive: true,
        ui: { section: "credentials" },
    },
    heartbeat_interval: {
        type: "number",
        label: "心跳间隔(秒)",
        ui: { section: "advanced" },
    },
    enable_cors: {
        type: "boolean",
        label: "启用 CORS",
        ui: { section: "advanced" },
    },
    filters: Protocol.FilterSchema,
};

ProtocolRegistry.registerSchema("onebot.v12", onebotV12Schema);

/**
 * OneBot V12 Protocol Implementation
 * Implements the OneBot 12 standard
 * Reference: https://12.onebot.dev
 */
export class OneBotV12Protocol extends Protocol<"v12", OneBotV12Config.Config> {
    public readonly name = "onebot";
    public readonly version = "v12" as const;
    private eventIdCounter = 0;
    private readonly actions: OneBotV12ActionService;
    private readonly transport: OneBotV12Transport;

    // Heartbeat timer
    private heartbeatTimer?: NodeJS.Timeout;
    constructor(adapter: Adapter, account: Account, config: OneBotV12Config.Config) {
        super(adapter, account, {
            ...config,
            protocol: "onebot",
            version: "v12",
        });
        this.actions = new OneBotV12ActionService({
            adapter,
            accountId: account.account_id,
            getSelfInfo: () => this.getSelfInfo(),
            convertToCommonSegments: segments => this.convertToCommonSegments(segments),
        });
        this.transport = new OneBotV12Transport({
            path: this.path,
            config: this.config,
            router: this.router,
            logger: this.logger,
            apply: (action, params) => this.apply(action, params),
            getVersionInfo: () => this.actions.getVersionInfo(),
            dispatchMetaEvent: (detailType, extra) => this.dispatchMetaEvent(detailType, extra),
            onDispatch: listener => this.on("dispatch", listener),
            offDispatch: listener => this.off("dispatch", listener),
        });
    }

    /**
     * Start the OneBot V12 protocol service
     */
    start(): void {
        this.transport.start();

        // 正向/反向 WebSocket 均需要心跳，不能只在 startWebSocket 里启动
        if (this.config.use_ws || this.config.ws_reverse?.length > 0) {
            this.setupHeartbeat();
        }
    }

    /**
     * Stop the protocol service
     */
    async stop(_force?: boolean): Promise<void> {
        this.logger.info(`Stopping OneBot V12 protocol`);

        // Clear heartbeat timer
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }

        this.transport.stop();

        this.removeAllListeners();
    }

    /**
     * Dispatch event to OneBot V12 format
     */
    async dispatch(event: CommonEvent.Event): Promise<void> {
        if (!this.filterFn(event)) {
            return;
        }

        const v12Event = this.convertToV12Format(event);
        if (v12Event) {
            this.logger.debug(`OneBot V12 dispatch:`, v12Event);
            await emitAllAwaited(this, "dispatch", JSON.stringify(v12Event));
        }
    }

    /**
     * Format event data to OneBot V12 specification
     */
    format(event: string, payload: Record<string, unknown>): Record<string, unknown> {
        return {
            id: this.generateEventId(),
            time: Math.floor(Date.now() / 1000),
            type: event,
            self: this.getSelfInfo(),
            ...payload,
        };
    }

    /**
     * Apply OneBot V12 API action
     */
    async apply(action: string, params?: Record<string, unknown>): Promise<OneBotV12.Response> {
        this.logger.debug(`OneBot V12 action: ${action}`, params);

        try {
            const result = await this.actions.execute(action, params);
            return {
                status: "ok",
                retcode: 0,
                data: result,
                message: "",
            };
        } catch (error) {
            this.logger.error(`OneBot V12 action ${action} failed:`, error);
            return {
                status: "failed",
                retcode: -1,
                data: null,
                message: error.message || String(error),
            };
        }
    }

    /** OneBot V12 事件与传输共享的机器人身份投影。 */
    private getSelfInfo(): OneBotV12.BotSelf {
        return {
            platform: this.account.platform as string,
            user_id: this.adapter.resolveId(this.account.account_id).string,
        };
    }

    // ============ Utility Methods ============

    /**
     * Convert common event to OneBot V12 format
     */
    private convertToV12Format(event: CommonEvent.Event): OneBotV12.Event | null {
        const base = {
            id: event.id.string,
            time: Math.floor(event.timestamp / 1000),
            self: this.getSelfInfo(),
        };

        if (event.type === "message") {
            const messageEvent: OneBotV12.MessageEvent = {
                ...base,
                type: "message",
                detail_type:
                    event.message_type === "private"
                        ? "private"
                        : event.message_type === "group"
                          ? "group"
                          : event.message_type === "channel"
                            ? "channel"
                            : "private",
                sub_type: "",
                message_id: event.message_id.string,
                message: this.convertToV12Segments(event.message),
                alt_message: event.raw_message,
                user_id: event.sender.id.string,
            };

            if (event.group && event.message_type === "group") {
                (messageEvent as OneBotV12.GroupMessageEvent).group_id = event.group.id.string;
            } else if (event.group && event.message_type === "channel") {
                if (!event.group.guild_id) {
                    this.logger.warn("频道事件缺少 guild_id，无法投影为合法 OneBot V12 事件");
                    return null;
                }
                const channelEvent = messageEvent as OneBotV12.ChannelMessageEvent;
                channelEvent.guild_id = event.group.guild_id.string;
                channelEvent.channel_id = event.group.channel_id?.string || event.group.id.string;
            }

            return messageEvent;
        } else if (event.type === "notice") {
            return {
                ...base,
                ...projectOneBotV12Notice(event),
            } as unknown as OneBotV12.NoticeEvent;
        } else if (event.type === "request") {
            const requestEvent: Record<string, unknown> = {
                ...base,
                type: "request",
                detail_type: event.request_type as string,
                sub_type: event.sub_type || "",
                request_id: event.id.string,
                user_id: event.user.id.string,
                comment: event.comment || "",
                flag: event.flag,
            };

            // 添加 request 事件的必要字段
            if (event.group) {
                requestEvent.group_id = event.group.id.string;
            }

            return requestEvent as unknown as OneBotV12.RequestEvent;
        } else if (event.type === "meta") {
            return {
                ...base,
                type: "meta",
                detail_type: event.meta_type as string,
                sub_type: event.sub_type || "",
            };
        }

        return null;
    }

    /**
     * Convert common segments to V12 segments
     */
    private convertToV12Segments(segments: CommonTypes.Segment[]): OneBotV12.Segment[] {
        return segments.map(seg => {
            // Map common segment types to V12 format
            if (seg.type === "at") {
                return {
                    type: "mention",
                    data: { user_id: seg.data.qq || seg.data.user_id },
                };
            }
            return {
                type: seg.type,
                data: seg.data,
            };
        });
    }

    /**
     * Convert V12 segments to common segments
     */
    private convertToCommonSegments(segments: OneBotV12.Segment[]): CommonTypes.Segment[] {
        return segments.map(seg => {
            // Map V12 segment types to common format
            if (seg.type === "mention") {
                return {
                    type: "at",
                    data: { qq: seg.data.user_id },
                };
            }
            return {
                type: seg.type,
                data: seg.data,
            };
        });
    }

    /**
     * Generate unique event ID
     */
    private generateEventId(): string {
        return `${this.account.platform}.${this.account.account_id}.${Date.now()}.${++this.eventIdCounter}`;
    }

    /**
     * 启动心跳定时器（每个协议实例仅一次）
     */
    private setupHeartbeat(): void {
        if (!this.config.heartbeat_interval || this.heartbeatTimer) {
            return;
        }

        // 配置为秒，转换为毫秒；至少 1 秒
        const intervalMs = Math.max(Number(this.config.heartbeat_interval) || 1, 1) * 1000;
        this.heartbeatTimer = setInterval(() => {
            this.dispatchMetaEvent("heartbeat", {
                interval: intervalMs,
            });
        }, intervalMs);
    }

    /**
     * Dispatch meta event
     */
    private dispatchMetaEvent(detailType: string, extra: Record<string, unknown> = {}): void {
        const event: OneBotV12.MetaEvent = {
            id: this.generateEventId(),
            time: Math.floor(Date.now() / 1000),
            type: "meta",
            detail_type: detailType,
            sub_type: "",
            self: this.getSelfInfo(),
            ...extra,
        };

        void emitAllAwaited(this, "dispatch", JSON.stringify(event)).catch(error =>
            this.logger.error(`OneBot V12 ${detailType} dispatch failed:`, error),
        );
    }
}

ProtocolRegistry.register("onebot", "v12", OneBotV12Protocol);

export * from "./types.js";
export * from "./config.js";
