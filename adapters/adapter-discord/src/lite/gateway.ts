/**
 * Discord Gateway WebSocket 客户端
 * 用于 Node.js 环境
 */

import { EventEmitter } from 'events';
import { DiscordREST } from './rest.js';
import { buildProxyUrl, createProxyAgent, ConnectionManager, RetryPresets } from '@onebots/core';

// Gateway Opcodes
export enum GatewayOpcodes {
    Dispatch = 0,
    Heartbeat = 1,
    Identify = 2,
    PresenceUpdate = 3,
    VoiceStateUpdate = 4,
    Resume = 6,
    Reconnect = 7,
    RequestGuildMembers = 8,
    InvalidSession = 9,
    Hello = 10,
    HeartbeatAck = 11,
}

// Gateway Intents
export enum GatewayIntents {
    Guilds = 1 << 0,
    GuildMembers = 1 << 1,
    GuildModeration = 1 << 2,
    GuildEmojisAndStickers = 1 << 3,
    GuildIntegrations = 1 << 4,
    GuildWebhooks = 1 << 5,
    GuildInvites = 1 << 6,
    GuildVoiceStates = 1 << 7,
    GuildPresences = 1 << 8,
    GuildMessages = 1 << 9,
    GuildMessageReactions = 1 << 10,
    GuildMessageTyping = 1 << 11,
    DirectMessages = 1 << 12,
    DirectMessageReactions = 1 << 13,
    DirectMessageTyping = 1 << 14,
    MessageContent = 1 << 15,
    GuildScheduledEvents = 1 << 16,
    AutoModerationConfiguration = 1 << 20,
    AutoModerationExecution = 1 << 21,
}

export interface GatewayOptions {
    token: string;
    intents: number;
    proxy?: {
        url: string;
        username?: string;
        password?: string;
    };
}

export class DiscordGateway extends EventEmitter {
    private ws: any = null;
    private token: string;
    private intents: number;
    private proxyUrl?: string;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private sequence: number | null = null;
    private sessionId: string | null = null;
    private resumeGatewayUrl: string | null = null;
    private rest: DiscordREST;
    private isReady = false;
    private connectionManager: ConnectionManager;

    constructor(options: GatewayOptions) {
        super();
        this.token = options.token;
        this.intents = options.intents;

        if (options.proxy?.url) {
            this.proxyUrl = buildProxyUrl(options.proxy);
        }

        this.rest = new DiscordREST({ token: options.token, proxy: options.proxy });

        // 使用 ConnectionManager 管理重连，支持指数退避
        this.connectionManager = new ConnectionManager(
            async () => {
                if (this.resumeGatewayUrl && this.sessionId) {
                    try {
                        await this.connectToGateway(`${this.resumeGatewayUrl}?v=10&encoding=json`);
                        this.resume();
                        return;
                    } catch {
                        // 恢复失败，降级到完整连接
                    }
                }
                const { url } = await this.rest.getGatewayBot();
                await this.connectToGateway(`${url}?v=10&encoding=json`);
            },
            RetryPresets.websocket,
            { logger: console }
        );
    }

    /**
     * 连接 Gateway
     */
    async connect(): Promise<void> {
        await this.connectionManager.start();
    }

    /**
     * 连接到指定 Gateway URL
     */
    private async connectToGateway(url: string): Promise<void> {
        // 动态导入 ws
        const { WebSocket } = await import('ws');
        
        // 如果有代理，使用共享代理工具
        let wsOptions: any = {};
        if (this.proxyUrl) {
            const agent = await createProxyAgent({ url: this.proxyUrl }, true);
            if (agent) {
                wsOptions.agent = agent;
                console.log(`[Gateway] 已配置代理`);
            } else {
                console.warn('[Gateway] 代理 agent 未安装，将直接连接');
            }
        }

        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(url, wsOptions);

            this.ws.on('open', () => {
                console.log('[Gateway] WebSocket 已连接');
            });

            this.ws.on('message', (data: Buffer) => {
                this.handleMessage(JSON.parse(data.toString()));
            });

            this.ws.on('close', (code: number, reason: Buffer) => {
                console.log(`[Gateway] WebSocket 关闭: ${code} - ${reason.toString()}`);
                this.cleanup();
                this.emit('close', code, reason.toString());

                // 使用 ConnectionManager 管理重连，支持指数退避
                if (code !== 1000 && code !== 4004) {
                    this.connectionManager.scheduleReconnect(new Error(`WebSocket closed with code ${code}`));
                }
            });

            this.ws.on('error', (error: Error) => {
                console.error('[Gateway] WebSocket 错误:', error);
                this.emit('error', error);
                reject(error);
            });

            // 设置超时
            const timeout = setTimeout(() => {
                if (!this.isReady) {
                    reject(new Error('Gateway 连接超时'));
                }
            }, 30000);

            this.once('ready', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }

    /**
     * 处理 Gateway 消息
     */
    private handleMessage(payload: any) {
        const { op, d, s, t } = payload;

        // 更新序列号
        if (s !== null) {
            this.sequence = s;
        }

        switch (op) {
            case GatewayOpcodes.Hello:
                this.startHeartbeat(d.heartbeat_interval);
                this.identify();
                break;

            case GatewayOpcodes.HeartbeatAck:
                // 心跳确认
                break;

            case GatewayOpcodes.Heartbeat:
                this.sendHeartbeat();
                break;

            case GatewayOpcodes.Dispatch:
                this.handleDispatch(t, d);
                break;

            case GatewayOpcodes.Reconnect:
                console.log('[Gateway] 收到重连请求');
                this.cleanup();
                this.connectionManager.scheduleReconnect(new Error('Discord requested reconnect'));
                break;

            case GatewayOpcodes.InvalidSession:
                console.log('[Gateway] 会话无效，重新识别');
                if (d) {
                    // 可恢复，尝试 resume
                    setTimeout(() => this.resume(), 1000);
                } else {
                    // 不可恢复，重新 identify
                    this.sessionId = null;
                    setTimeout(() => this.identify(), 1000);
                }
                break;
        }
    }

    /**
     * 处理 Dispatch 事件
     */
    private handleDispatch(eventName: string, data: any) {
        switch (eventName) {
            case 'READY':
                this.sessionId = data.session_id;
                this.resumeGatewayUrl = data.resume_gateway_url;
                this.isReady = true;
                this.emit('ready', data.user);
                break;

            case 'RESUMED':
                console.log('[Gateway] 会话已恢复');
                this.emit('resumed');
                break;

            case 'MESSAGE_CREATE':
                this.emit('messageCreate', data);
                break;

            case 'MESSAGE_UPDATE':
                this.emit('messageUpdate', data);
                break;

            case 'MESSAGE_DELETE':
                this.emit('messageDelete', data);
                break;

            case 'GUILD_CREATE':
                this.emit('guildCreate', data);
                break;

            case 'GUILD_DELETE':
                this.emit('guildDelete', data);
                break;

            case 'GUILD_MEMBER_ADD':
                this.emit('guildMemberAdd', data);
                break;

            case 'GUILD_MEMBER_REMOVE':
                this.emit('guildMemberRemove', data);
                break;

            case 'INTERACTION_CREATE':
                this.emit('interactionCreate', data);
                break;

            default:
                // 发送通用事件
                this.emit('dispatch', eventName, data);
        }
    }

    /**
     * 发送 Identify
     */
    private identify() {
        this.send({
            op: GatewayOpcodes.Identify,
            d: {
                token: this.token,
                intents: this.intents,
                properties: {
                    os: typeof process !== 'undefined' ? process.platform : 'unknown',
                    browser: 'onebots-lite',
                    device: 'onebots-lite',
                },
            },
        });
    }

    /**
     * 发送 Resume
     */
    private resume() {
        if (!this.sessionId || !this.sequence) {
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
        setTimeout(() => {
            this.sendHeartbeat();
            this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), interval);
        }, jitter);
    }

    /**
     * 停止心跳
     */
    private stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * 发送心跳
     */
    private sendHeartbeat() {
        this.send({
            op: GatewayOpcodes.Heartbeat,
            d: this.sequence,
        });
    }

    /**
     * 发送数据
     */
    private send(data: any) {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify(data));
        }
    }

    /**
     * 清理资源
     */
    private cleanup() {
        this.stopHeartbeat();
        this.isReady = false;
        
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
        this.connectionManager.stop();
        this.sessionId = null;
        this.resumeGatewayUrl = null;
        this.cleanup();
    }

    /**
     * 获取 REST 客户端
     */
    getREST(): DiscordREST {
        return this.rest;
    }
}

