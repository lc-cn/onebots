/**
 * Discord Gateway WebSocket 客户端
 * 用于 Node.js 环境
 */

import { EventEmitter } from 'events';
import { DiscordREST } from './rest.js';

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
    private static readonly BASE_RECONNECT_DELAY_MS = 1000;
    private static readonly MAX_RECONNECT_DELAY_MS = 30000;

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
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;

    constructor(options: GatewayOptions) {
        super();
        this.token = options.token;
        this.intents = options.intents;
        
        if (options.proxy?.url) {
            const proxyUrl = new URL(options.proxy.url);
            if (options.proxy.username) proxyUrl.username = options.proxy.username;
            if (options.proxy.password) proxyUrl.password = options.proxy.password;
            this.proxyUrl = proxyUrl.toString();
        }

        this.rest = new DiscordREST({ token: options.token, proxy: options.proxy });
    }

    /**
     * 连接 Gateway
     */
    async connect(): Promise<void> {
        // 获取 Gateway URL
        const { url } = await this.rest.getGatewayBot();
        const gatewayUrl = `${url}?v=10&encoding=json`;

        return this.connectToGateway(gatewayUrl);
    }

    /**
     * 连接到指定 Gateway URL
     */
    private async connectToGateway(url: string): Promise<void> {
        // 动态导入 ws
        const { WebSocket } = await import('ws');
        
        // 如果有代理，使用 socks-proxy-agent (WebSocket 更稳定)
        let wsOptions: any = {};
        if (this.proxyUrl) {
            try {
                // 优先使用 SOCKS5 代理 (对 WebSocket 支持更好)
                // 将 http:// 代理转换为 socks5:// (Clash 混合端口同时支持)
                const socksUrl = this.proxyUrl.replace(/^https?:\/\//, 'socks5://');
                // @ts-ignore - socks-proxy-agent 是可选依赖
                const { SocksProxyAgent } = await import('socks-proxy-agent');
                wsOptions.agent = new SocksProxyAgent(socksUrl);
                console.log(`[Gateway] 使用 SOCKS5 代理: ${socksUrl.replace(/\/\/[^@]+@/, '//***:***@')}`);
            } catch {
                // 回退到 https-proxy-agent
                try {
                    // @ts-ignore - https-proxy-agent 是可选依赖
                    const { HttpsProxyAgent } = await import('https-proxy-agent');
                    wsOptions.agent = new HttpsProxyAgent(this.proxyUrl);
                    console.log(`[Gateway] 使用 HTTP 代理: ${this.proxyUrl.replace(/\/\/[^@]+@/, '//***:***@')}`);
                } catch {
                    console.warn('[Gateway] 代理 agent 未安装，将直接连接');
                }
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
                
                // 自动重连 (指数退避)
                if (code !== 1000 && code !== 4004) {
                    const delay = Math.min(
                        DiscordGateway.BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts || 0),
                        DiscordGateway.MAX_RECONNECT_DELAY_MS
                    );
                    this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
                    this.clearReconnectTimer();
                    this.reconnectTimer = setTimeout(() => {
                        this.reconnectTimer = null;
                        void this.reconnect();
                    }, delay);
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
                this.reconnect();
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
                this.reconnectAttempts = 0;
                this.clearReconnectTimer();
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
     * 重连
     */
    private async reconnect() {
        if (this.isReady && this.ws && this.ws.readyState === 1) {
            return;
        }

        this.cleanup();
        
        if (this.resumeGatewayUrl && this.sessionId) {
            // 尝试恢复
            try {
                await this.connectToGateway(`${this.resumeGatewayUrl}?v=10&encoding=json`);
                this.resume();
                return;
            } catch {
                // 恢复失败，重新连接
            }
        }

        // 重新连接
        await this.connect();
    }

    /**
     * 清理资源
     */
    private cleanup() {
        this.clearReconnectTimer();
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
        this.sessionId = null;
        this.resumeGatewayUrl = null;
        this.cleanup();
    }

    private clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * 获取 REST 客户端
     */
    getREST(): DiscordREST {
        return this.rest;
    }
}
