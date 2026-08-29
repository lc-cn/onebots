/**
 * Discord Gateway WebSocket 客户端
 * 用于 Node.js 环境
 */

import { EventEmitter } from "node:events";
import { DiscordREST } from "./rest.js";
import { buildProxyUrl, createProxyAgent, ConnectionManager, RetryPresets } from "onebots";
import type { Agent } from "http";
import type {
    DiscordApiGuild,
    DiscordApiGuildMember,
    DiscordApiMessage,
    DiscordMessageDeleteData,
    DiscordMessageUpdateData,
    DiscordInteraction,
    GatewayHelloData,
    GatewayReadyData,
    DiscordGuildDeleteData,
    DiscordGuildMemberRemoveData,
} from "../types.js";
import { DiscordError } from "../errors.js";
import { assertDiscordProxyConfig } from "../config-types.js";
import {
    GatewayOpcodes,
    type DiscordGatewayEvents,
    type GatewayOptions,
    type GatewayPayload,
    type WsWebSocket,
    isFatalGatewayCloseCode,
} from "./gateway-types.js";
export { GatewayIntents, GatewayOpcodes } from "./gateway-types.js";
export type { DiscordGatewayEvents, GatewayOptions } from "./gateway-types.js";

export class DiscordGateway extends EventEmitter<DiscordGatewayEvents> {
    private ws: WsWebSocket | null = null;
    private token: string;
    private intents: number;
    private proxyUrl?: string;
    private heartbeatStartTimer: NodeJS.Timeout | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private sessionRetryTimer: NodeJS.Timeout | null = null;
    private pendingConnectionReject?: (error: Error) => void;
    private sequence: number | null = null;
    private sessionId: string | null = null;
    private resumeGatewayUrl: string | null = null;
    private resumeOnHello = false;
    private rest: DiscordREST;
    private isReady = false;
    private started = false;
    private heartbeatAcknowledged = true;
    private lastIdentifyAt = 0;
    private readonly presence?: GatewayOptions["presence"];
    private readonly shard?: GatewayOptions["shard"];
    private connectionManager: ConnectionManager;

    constructor(options: GatewayOptions) {
        super();
        this.token = options.token;
        this.intents = options.intents;
        this.presence = options.presence;
        this.shard = options.shard;

        assertDiscordProxyConfig(options.proxy);
        if (options.proxy?.url) {
            this.proxyUrl = buildProxyUrl(options.proxy);
        }

        this.rest = new DiscordREST({ token: options.token, proxy: options.proxy });

        // 使用 ConnectionManager 管理重连，支持指数退避
        this.connectionManager = new ConnectionManager(
            async () => {
                if (this.resumeGatewayUrl && this.sessionId) {
                    try {
                        await this.connectToGateway(
                            `${this.resumeGatewayUrl}?v=10&encoding=json`,
                            true,
                        );
                        return;
                    } catch (error) {
                        this.sessionId = null;
                        this.resumeGatewayUrl = null;
                        throw DiscordError.wrap(error, "DISCORD_GATEWAY_RESUME_FAILED");
                    }
                }
                const { url } = await this.rest.getGatewayBot();
                await this.connectToGateway(`${url}?v=10&encoding=json`, false);
            },
            RetryPresets.websocket,
            {},
        );
    }

    /**
     * 连接 Gateway
     */
    async connect(signal?: AbortSignal): Promise<void> {
        if (this.started) return;
        if (signal?.aborted) {
            throw new DiscordError("Discord Gateway 启动已取消", {
                code: "DISCORD_GATEWAY_ABORTED",
            });
        }
        signal?.addEventListener("abort", () => this.disconnect(), { once: true });
        this.started = true;
        await this.connectionManager.start();
    }

    /**
     * 连接到指定 Gateway URL
     */
    private async connectToGateway(url: string, resume: boolean): Promise<void> {
        // 动态导入 ws
        const { WebSocket } = await import("ws");

        // 如果有代理，使用共享代理工具
        const wsOptions: { agent?: Agent } = {};
        if (this.proxyUrl) {
            const agent = await createProxyAgent({ url: this.proxyUrl }, true);
            if (!agent) {
                throw DiscordError.configuration(
                    "Discord Gateway 代理不可用",
                    "DISCORD_PROXY_UNAVAILABLE",
                );
            }
            wsOptions.agent = agent as Agent;
        }

        return new Promise((resolve, reject) => {
            const socket = new WebSocket(url, wsOptions) as unknown as WsWebSocket;
            this.ws = socket;
            this.resumeOnHello = resume;
            let settled = false;
            let timeout: NodeJS.Timeout;
            const onReady = () => {
                if (settled || this.ws !== socket) return;
                settled = true;
                clearTimeout(timeout);
                this.pendingConnectionReject = undefined;
                resolve();
            };
            const fail = (error: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                this.off("connected", onReady);
                if (this.pendingConnectionReject === fail) {
                    this.pendingConnectionReject = undefined;
                }
                reject(error);
            };
            this.pendingConnectionReject = fail;

            socket.on("message", (data: unknown) => {
                if (this.ws !== socket) return;
                try {
                    const buffer = data as Buffer;
                    this.handleMessage(JSON.parse(buffer.toString()));
                } catch (error) {
                    this.emit(
                        "client_error",
                        DiscordError.wrap(error, "DISCORD_GATEWAY_PAYLOAD_INVALID"),
                    );
                }
            });

            socket.on("close", (code: unknown, reason: unknown) => {
                if (this.ws !== socket) return;
                const closeCode = code as number;
                const closeReason = Buffer.isBuffer(reason)
                    ? reason.toString()
                    : String(reason ?? "");
                const error = new DiscordError(
                    `Discord Gateway 已关闭（${closeCode}${closeReason ? `：${closeReason}` : ""}）`,
                    {
                        code: isFatalGatewayCloseCode(closeCode)
                            ? "DISCORD_GATEWAY_FATAL_CLOSE"
                            : "DISCORD_GATEWAY_CLOSED",
                    },
                );
                const fatal = isFatalGatewayCloseCode(closeCode);
                if (fatal) this.connectionManager.stop();
                this.cleanup(error);
                this.emit("close", closeCode, closeReason);
                if (fatal) this.emit("client_error", error);
                else this.scheduleReconnect(error);
            });

            socket.on("error", (error: unknown) => {
                if (this.ws !== socket) return;
                this.scheduleReconnect(DiscordError.wrap(error, "DISCORD_GATEWAY_SOCKET_ERROR"));
            });

            timeout = setTimeout(() => {
                if (!settled && this.ws === socket) {
                    this.scheduleReconnect(
                        new DiscordError("Discord Gateway 连接超时", {
                            code: "DISCORD_GATEWAY_TIMEOUT",
                        }),
                    );
                }
            }, 30000);

            this.once("connected", onReady);
        });
    }

    /**
     * 处理 Gateway 消息
     */
    private handleMessage(rawPayload: unknown) {
        const payload = rawPayload as GatewayPayload;
        const { op, d, s, t } = payload;

        // 更新序列号
        if (s !== null) {
            this.sequence = s;
        }

        switch (op) {
            case GatewayOpcodes.Hello: {
                const helloData = d as GatewayHelloData;
                this.heartbeatAcknowledged = true;
                this.startHeartbeat(helloData.heartbeat_interval);
                if (this.resumeOnHello) this.resume();
                else this.identify();
                break;
            }

            case GatewayOpcodes.HeartbeatAck:
                this.heartbeatAcknowledged = true;
                break;

            case GatewayOpcodes.Heartbeat:
                this.sendHeartbeat();
                break;

            case GatewayOpcodes.Dispatch:
                if (typeof t === "string") this.handleDispatch(t, d);
                break;

            case GatewayOpcodes.Reconnect:
                this.scheduleReconnect(
                    new DiscordError("Discord 要求重新连接 Gateway", {
                        code: "DISCORD_GATEWAY_RECONNECT_REQUESTED",
                    }),
                );
                break;

            case GatewayOpcodes.InvalidSession: {
                const isResumable = d as boolean;
                if (this.sessionRetryTimer) clearTimeout(this.sessionRetryTimer);
                if (isResumable) {
                    this.sessionRetryTimer = setTimeout(() => {
                        this.sessionRetryTimer = null;
                        this.resume();
                    }, 1000);
                } else {
                    this.sessionId = null;
                    this.sequence = null;
                    this.sessionRetryTimer = setTimeout(
                        () => {
                            this.sessionRetryTimer = null;
                            this.identify();
                        },
                        1_000 + Math.random() * 4_000,
                    );
                }
                break;
            }
        }
    }

    /**
     * 处理 Dispatch 事件
     */
    private handleDispatch(eventName: string, data: unknown) {
        if (eventName === "READY") {
            const ready = data as GatewayReadyData;
            this.sessionId = ready.session_id;
            this.resumeGatewayUrl = ready.resume_gateway_url;
        }
        // 所有 Gateway Dispatch 都先走统一原始事件通道；具名事件只是便捷别名。
        // Adapter 以此保证 Discord 新增事件不会在 SDK 更新前被静默丢弃。
        this.emit("dispatch", eventName, data, this.sequence, this.sessionId);
        switch (eventName) {
            case "READY": {
                const readyData = data as GatewayReadyData;
                this.isReady = true;
                this.emit("connected");
                this.emit("ready", readyData.user);
                break;
            }

            case "RESUMED":
                this.isReady = true;
                this.emit("connected");
                this.emit("resumed");
                break;

            case "MESSAGE_CREATE":
                this.emit("messageCreate", data as DiscordApiMessage);
                break;

            case "MESSAGE_UPDATE":
                this.emit("messageUpdate", data as DiscordMessageUpdateData);
                break;

            case "MESSAGE_DELETE":
                this.emit("messageDelete", data as DiscordMessageDeleteData);
                break;

            case "GUILD_CREATE":
                this.emit("guildCreate", data as DiscordApiGuild);
                break;

            case "GUILD_DELETE":
                this.emit("guildDelete", data as DiscordGuildDeleteData);
                break;

            case "GUILD_MEMBER_ADD":
                this.emit("guildMemberAdd", data as DiscordApiGuildMember);
                break;

            case "GUILD_MEMBER_REMOVE":
                this.emit("guildMemberRemove", data as DiscordGuildMemberRemoveData);
                break;

            case "INTERACTION_CREATE":
                this.emit("interactionCreate", data as DiscordInteraction);
                break;

            default:
                // 原始 dispatch 已在 switch 前发送。
                break;
        }
    }

    /**
     * 发送 Identify
     */
    private identify() {
        const delay = Math.max(0, 5_000 - (Date.now() - this.lastIdentifyAt));
        if (delay > 0) {
            if (this.sessionRetryTimer) clearTimeout(this.sessionRetryTimer);
            this.sessionRetryTimer = setTimeout(() => {
                this.sessionRetryTimer = null;
                this.identify();
            }, delay);
            return;
        }
        this.lastIdentifyAt = Date.now();
        this.send({
            op: GatewayOpcodes.Identify,
            d: {
                token: this.token,
                intents: this.intents,
                properties: {
                    os: typeof process !== "undefined" ? process.platform : "unknown",
                    browser: "onebots-lite",
                    device: "onebots-lite",
                },
                presence: this.presence,
                shard: this.shard,
            },
        });
    }

    /**
     * 发送 Resume
     */
    private resume() {
        if (!this.sessionId || this.sequence === null) {
            this.identify();
            return;
        }

        this.send({
            op: GatewayOpcodes.Resume,
            d: {
                token: this.token,
                session_id: this.sessionId,
                seq: this.sequence,
            },
        });
    }

    /**
     * 开始心跳
     */
    private startHeartbeat(interval: number) {
        this.stopHeartbeat();

        // 首次心跳添加随机抖动
        const jitter = Math.random() * interval;
        this.heartbeatStartTimer = setTimeout(() => {
            this.heartbeatStartTimer = null;
            this.sendHeartbeat();
            this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), interval);
        }, jitter);
    }

    /**
     * 停止心跳
     */
    private stopHeartbeat() {
        if (this.heartbeatStartTimer) {
            clearTimeout(this.heartbeatStartTimer);
            this.heartbeatStartTimer = null;
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * 发送心跳
     */
    private sendHeartbeat() {
        if (!this.heartbeatAcknowledged) {
            this.scheduleReconnect(
                new DiscordError("Discord Gateway 心跳确认超时", {
                    code: "DISCORD_GATEWAY_HEARTBEAT_TIMEOUT",
                }),
            );
            return;
        }
        this.send({
            op: GatewayOpcodes.Heartbeat,
            d: this.sequence,
        });
        this.heartbeatAcknowledged = false;
    }

    /**
     * 发送数据
     */
    private send(data: Record<string, unknown>) {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify(data));
        }
    }

    private scheduleReconnect(error: DiscordError): void {
        this.cleanup(error);
        this.emit("client_error", error);
        this.emit("reconnecting", error);
        this.connectionManager.scheduleReconnect(error);
    }

    /**
     * 清理资源
     */
    private cleanup(connectionError?: Error) {
        const reject = this.pendingConnectionReject;
        this.pendingConnectionReject = undefined;
        reject?.(
            connectionError ??
                new DiscordError("Discord Gateway 已停止", {
                    code: "DISCORD_GATEWAY_STOPPED",
                }),
        );
        this.stopHeartbeat();
        if (this.sessionRetryTimer) {
            clearTimeout(this.sessionRetryTimer);
            this.sessionRetryTimer = null;
        }
        this.isReady = false;
        this.heartbeatAcknowledged = true;
        this.resumeOnHello = false;

        if (this.ws) {
            this.ws.removeAllListeners();
            if (this.ws.readyState === 1) {
                this.ws.close();
            }
            this.ws = null;
        }
    }

    /**
     * 断开连接
     */
    disconnect() {
        this.started = false;
        this.connectionManager.stop();
        this.sessionId = null;
        this.resumeGatewayUrl = null;
        this.cleanup(
            new DiscordError("Discord Gateway 已停止", { code: "DISCORD_GATEWAY_STOPPED" }),
        );
    }

    /**
     * 获取 REST 客户端
     */
    getREST(): DiscordREST {
        return this.rest;
    }
}
