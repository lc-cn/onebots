import { emitAllAwaited, Protocol, ProtocolRegistry } from "onebots";
import type { Schema } from "onebots";
import { Account } from "onebots";
import { Adapter } from "onebots";
import { CommonEvent, CommonTypes } from "onebots";
import { OneBotV11ActionService } from "./actions/index.js";
import { CQCode } from "./cqcode.js";
import { OneBotV11Config } from "./config.js";
import { OneBotV11Transport } from "./transport.js";

const onebotV11Schema: Schema = {
    use_http: { type: "boolean", default: true, label: "启用 HTTP", ui: { section: "transport" } },
    use_ws: {
        type: "boolean",
        default: false,
        label: "启用 WebSocket",
        ui: { section: "transport" },
    },
    http_reverse: {
        type: "array",
        default: [],
        label: "HTTP 反向上报",
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
    enable_cors: {
        type: "boolean",
        label: "启用 CORS",
        ui: { section: "advanced" },
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
    post_timeout: {
        type: "number",
        label: "POST 超时(秒)",
        ui: { section: "advanced" },
    },
    post_message_format: {
        type: "string",
        default: "array",
        label: "消息格式",
        choices: [
            { value: "array", label: "数组 (array)" },
            { value: "string", label: "字符串 (string / CQ 码)" },
        ],
        ui: { section: "advanced" },
    },
    serve_data_files: {
        type: "boolean",
        label: "静态文件服务",
        ui: { section: "advanced" },
    },
    heartbeat_interval: {
        type: "number",
        label: "心跳间隔(秒)",
        ui: { section: "advanced" },
    },
    filters: Protocol.FilterSchema,
};

ProtocolRegistry.registerSchema("onebot.v11", onebotV11Schema);

/**
 * OneBot V11 Protocol Implementation
 * Implements the OneBot 11 standard
 * Reference: https://github.com/botuniverse/onebot-v11
 */
export class OneBotV11Protocol extends Protocol<"v11", OneBotV11Config.Config> {
    public readonly name = "onebot";
    public readonly version = "v11" as const;

    // Message ID transformation maps (V11 requires integer message IDs)
    private messageIdMap = new Map<number, string>();
    private reverseMessageIdMap = new Map<string, number>();
    private messageIdCounter = 0;
    private static readonly MAX_MESSAGE_ID_MAP_SIZE = 10000;
    private static readonly EVICTION_RATIO = 0.2;
    private readonly actions: OneBotV11ActionService;

    private readonly transport: OneBotV11Transport;

    constructor(adapter: Adapter, account: Account, config: OneBotV11Config.Config) {
        super(adapter, account, {
            ...config,
            protocol: "onebot",
            version: "v11",
        });
        this.actions = new OneBotV11ActionService({
            adapter,
            accountId: account.account_id,
            resolveId: id => this.resolveV11Id(id),
            parseMessage: (message, autoEscape) => this.parseMessage(message, autoEscape),
            convertSegments: segments => this.convertSegmentsToV11(segments),
            convertMessageInfo: message => this.convertMessageInfoToV11(message),
            clearMessageIds: () => {
                this.messageIdMap.clear();
                this.reverseMessageIdMap.clear();
            },
        });
        this.transport = new OneBotV11Transport({
            accountId: account.account_id,
            path: this.path,
            config: this.config,
            router: this.router,
            logger: this.logger,
            apply: (action, params) => this.apply(action, params),
            format: (event, payload) => this.format(event, payload),
            onDispatch: listener => this.on("dispatch", listener),
            offDispatch: listener => this.off("dispatch", listener),
            dispatchEmitter: this,
        });
    }
    get db() {
        return this.adapter.app.db;
    }

    /**
     * Start the OneBot V11 protocol service
     */
    start(): void {
        this.transport.start();
    }

    /**
     * Stop the protocol service
     */
    async stop(_force?: boolean): Promise<void> {
        this.logger.info(`Stopping OneBot V11 protocol`);

        this.transport.stop();

        // Clean up resources
        this.messageIdMap.clear();
        this.reverseMessageIdMap.clear();
        this.removeAllListeners();
    }

    /**
     * Dispatch event to OneBot V11 format
     */
    async dispatch(event: CommonEvent.Event): Promise<void> {
        this.logger.debug(
            `[OneBot V11] Received event:`,
            event.type,
            (event as Record<string, unknown>).message_type || "",
        );

        // 检查 filterFn
        let filterResult: boolean;
        try {
            filterResult = this.filterFn(event);
            this.logger.debug(`[OneBot V11] Filter result:`, filterResult);
        } catch (error) {
            this.logger.error(`[OneBot V11] Filter error:`, error);
            throw error;
        }

        if (!filterResult) {
            this.logger.debug(`[OneBot V11] Event filtered out:`, event.type);
            return;
        }

        this.logger.debug(`[OneBot V11] Event passed filter, converting...`);

        try {
            const v11Event = this.convertToV11Format(event);
            this.logger.debug(
                `[OneBot V11] Conversion completed, result:`,
                v11Event ? "success" : "null",
            );

            if (v11Event) {
                const eventData = JSON.stringify(v11Event);
                this.logger.debug(`[OneBot V11] Converted event:`, eventData.substring(0, 200));
                this.logger.debug(
                    `[OneBot V11] Emitting dispatch event, listener count:`,
                    this.listenerCount("dispatch"),
                );
                await emitAllAwaited(this, "dispatch", eventData);
                this.logger.debug(`[OneBot V11] Event dispatched to WebSocket clients`);
            } else {
                this.logger.warn(
                    `[OneBot V11] Failed to convert event to V11 format:`,
                    event.type,
                    JSON.stringify(event).substring(0, 200),
                );
            }
        } catch (error) {
            this.logger.error(`[OneBot V11] Error dispatching event:`, error);
            throw error;
        }
    }
    /**
     * Format event data to OneBot V11 specification
     */
    format(event: string, payload: Record<string, unknown>): Record<string, unknown> {
        return {
            time: Math.floor(Date.now() / 1000),
            self_id: this.adapter.resolveId(this.account.account_id).number,
            post_type: event,
            ...payload,
        };
    }

    /**
     * Apply OneBot V11 API action
     */
    async apply(
        action: string,
        params?: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        this.logger.debug(`OneBot V11 action: ${action}`, params);

        try {
            const result = await this.actions.execute(action, params);
            return {
                status: "ok",
                retcode: 0,
                data: result,
            };
        } catch (error) {
            this.logger.error(`OneBot V11 action ${action} failed:`, error);
            return {
                status: "failed",
                retcode: -1,
                msg: error.message,
            };
        }
    }

    /**
     * Convert common event to OneBot V11 format
     */
    private convertToV11Format(event: CommonEvent.Event): Record<string, unknown> | null {
        try {
            const base = {
                time: Math.floor(event.timestamp / 1000),
                self_id: this.adapter.resolveId(this.account.account_id).number,
            };

            if (event.type === "message") {
                // OneBot V11 只支持 private 和 group，将 channel 和 direct 映射为 group
                let messageType = event.message_type;
                if (messageType === "channel" || messageType === "direct") {
                    messageType = "group";
                }

                // 确保 message_id 和 sender.id 输出为框架层 Id.number（与 V11 数值 ID 对齐）
                const messageIdObj = event.message_id as CommonTypes.Id;
                const senderIdObj = event.sender?.id as CommonTypes.Id;

                const messageId =
                    messageIdObj?.number ??
                    this.transformToInt(
                        messageIdObj?.string || String(messageIdObj || event.message_id),
                    );
                const userId =
                    senderIdObj?.number ??
                    this.transformToInt(
                        senderIdObj?.string || String(senderIdObj || event.sender?.id),
                    );

                const result = {
                    ...base,
                    post_type: "message",
                    message_type: messageType,
                    sub_type: messageType === "private" ? "friend" : "normal",
                    message_id: messageId,
                    user_id: userId,
                    message: this.convertSegmentsToV11(event.message || []),
                    raw_message: event.raw_message || this.segmentsToString(event.message || []),
                    font: 0,
                    sender: {
                        user_id: userId,
                        nickname: event.sender?.name || "",
                        // 只展开 event.sender 中非 id 的字段，避免将 Id 对象混入
                        ...(event.sender
                            ? Object.fromEntries(
                                  Object.entries(event.sender).filter(([key]) => key !== "id"),
                              )
                            : {}),
                    },
                    ...(event.group
                        ? {
                              group_id: Number(
                                  (event.group.id as CommonTypes.Id)?.number ??
                                      (event.group.id as CommonTypes.Id)?.string ??
                                      event.group.id,
                              ),
                          }
                        : {}),
                };

                this.logger.debug(`[OneBot V11] Conversion successful:`, {
                    messageType,
                    messageId,
                    userId,
                    hasGroup: !!event.group,
                });

                return result;
            } else if (event.type === "notice") {
                return {
                    ...base,
                    post_type: "notice",
                    notice_type: event.notice_type,
                    ...(event.user ? { user_id: (event.user.id as CommonTypes.Id)?.number } : {}),
                    ...(event.operator
                        ? { operator_id: (event.operator.id as CommonTypes.Id)?.number }
                        : {}),
                    ...(event.group
                        ? { group_id: (event.group.id as CommonTypes.Id)?.number }
                        : {}),
                };
            } else if (event.type === "request") {
                return {
                    ...base,
                    post_type: "request",
                    request_type: event.request_type,
                    user_id: (event.user.id as CommonTypes.Id)?.number,
                    comment: event.comment || "",
                    flag: event.flag,
                    ...(event.group
                        ? { group_id: (event.group.id as CommonTypes.Id)?.number }
                        : {}),
                };
            } else if (event.type === "meta") {
                return {
                    ...base,
                    post_type: "meta_event",
                    meta_event_type: event.meta_type,
                    sub_type: event.sub_type,
                };
            }

            this.logger.warn(
                `[OneBot V11] Unknown event type:`,
                (event as Record<string, unknown>).type,
            );
            return null;
        } catch (error) {
            this.logger.error(`[OneBot V11] Error in convertToV11Format:`, error, {
                eventType: (event as Record<string, unknown>).type,
                messageType: (event as Record<string, unknown>).message_type,
                hasMessageId: !!(event as Record<string, unknown>).message_id,
                hasSender: !!(event as Record<string, unknown>).sender,
            });
            throw error;
        }
    }

    /**
     * Convert message segments to V11 format
     */
    private convertSegmentsToV11(
        segments: CommonTypes.Segment[],
    ): { type: string; data: unknown }[] {
        return segments.map(seg => ({
            type: seg.type,
            data: seg.data,
        }));
    }

    /**
     * Parse message (string or array) to segments
     */
    private parseMessage(
        message: string | CommonTypes.Segment[],
        auto_escape: boolean,
    ): CommonTypes.Segment[] {
        if (Array.isArray(message)) {
            return message.map(seg => ({
                type: seg.type,
                data: seg.data,
            }));
        }

        if (auto_escape) {
            return [{ type: "text", data: { text: message } }];
        }

        // Parse CQ code format
        return CQCode.parse(message);
    }

    /**
     * Convert segments to plain text string
     */
    private segmentsToString(segments: CommonTypes.Segment[]): string {
        return CQCode.toText(segments);
    }

    /**
     * Transform string message ID to integer (V11 requirement)
     */
    private transformToInt(messageId: string | number | CommonTypes.Id): number {
        // 若已是框架层 Id，优先使用其 number（与 id_map / V11 数值域一致）
        if (messageId && typeof messageId === "object" && "number" in messageId) {
            return (messageId as CommonTypes.Id).number;
        }

        if (typeof messageId === "number") {
            return messageId;
        }

        const idString = String(messageId);
        if (this.reverseMessageIdMap.has(idString)) {
            return this.reverseMessageIdMap.get(idString)!;
        }

        // Evict oldest entries when map exceeds max size
        if (this.messageIdMap.size >= OneBotV11Protocol.MAX_MESSAGE_ID_MAP_SIZE) {
            const entriesToDelete = Math.floor(
                OneBotV11Protocol.MAX_MESSAGE_ID_MAP_SIZE * OneBotV11Protocol.EVICTION_RATIO,
            );
            const iter = this.messageIdMap.entries();
            for (let i = 0; i < entriesToDelete; i++) {
                const entry = iter.next();
                if (entry.done) break;
                const [key, val] = entry.value;
                this.messageIdMap.delete(key);
                this.reverseMessageIdMap.delete(val);
            }
        }

        const intId = ++this.messageIdCounter;
        this.messageIdMap.set(intId, idString);
        this.reverseMessageIdMap.set(idString, intId);
        return intId;
    }

    private resolveV11Id(id: string | number | CommonTypes.Id): CommonTypes.Id {
        if (typeof id === "string" && /^-?\d+$/.test(id)) {
            return this.adapter.resolveId(Number(id));
        }
        return this.adapter.resolveId(id);
    }

    /**
     * Convert message info to V11 format
     */
    private convertMessageInfoToV11(msg: Adapter.MessageInfo): Record<string, unknown> {
        return {
            time: msg.time,
            message_type: msg.sender.scene_type,
            message_id: msg.message_id.number,
            real_id: msg.message_id.number,
            sender: {
                user_id: msg.sender.sender_id.number,
                nickname: msg.sender.sender_name,
            },
            message: this.convertSegmentsToV11(msg.message),
        };
    }
}
ProtocolRegistry.register("onebot", "v11", OneBotV11Protocol);
export { CQCode } from "./cqcode.js";
export * from "./types.js";
export * from "./utils.js";
export * from "./config.js";
