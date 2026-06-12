/**
 * Zulip Bot 客户端
 * 基于 Zulip REST API 和 WebSocket API
 */
import { EventEmitter } from 'events';
import axios, { AxiosInstance } from 'axios';
import type { Agent as HttpAgent } from 'http';
import WebSocket from 'ws';
import { createRequire } from 'module';
import type {
    ZulipConfig,
    ZulipSendMessageParams,
    ZulipAPIResponse,
    ZulipWebSocketEvent,
    ZulipMessageEvent,
    ZulipStreamsResponse,
    ZulipUserResponse,
    ZulipUser,
    ProxyConfig,
} from './types.js';
import { buildProxyUrl, maskProxyUrl, createHttpsProxyAgent, ConnectionManager, RetryPresets } from 'onebots';

const require = createRequire(import.meta.url);

export class ZulipBot extends EventEmitter {
    private config: ZulipConfig;
    private apiClient: AxiosInstance;
    private ws: WebSocket | null = null;
    private connectionManager: ConnectionManager;
    private isConnected: boolean = false;
    private agent: HttpAgent | null = null;
    private initialized: boolean = false;

    constructor(config: ZulipConfig) {
        super();
        this.config = config;
        this.apiClient = this.createAPIClient();
        this.connectionManager = new ConnectionManager(
            () => this.connectWebSocket(),
            RetryPresets.websocket,
        );
    }

    /**
     * 创建 API 客户端
     */
    private createAPIClient(): AxiosInstance {
        const baseURL = `${this.config.serverUrl}/api/v1`;

        // Zulip 使用 HTTP Basic Auth
        const auth = Buffer.from(`${this.config.email}:${this.config.apiKey}`).toString('base64');

        const client = axios.create({
            baseURL,
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        return client;
    }

    /**
     * 初始化代理 Agent
     */
    private async initAgent(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;

        if (!this.config.proxy?.url) return;

        try {
            const agent = await createHttpsProxyAgent(this.config.proxy);
            if (agent) {
                this.agent = agent as HttpAgent;
                console.log(`[Zulip] 已配置代理: ${maskProxyUrl(buildProxyUrl(this.config.proxy))}`);
            } else {
                console.warn('[Zulip] 创建代理失败，将直接连接');
            }
        } catch (error) {
            console.warn('[Zulip] 创建代理失败，将直接连接:', error);
        }
    }

    /**
     * 启动 Bot（初始化连接）
     */
    async start(): Promise<void> {
        await this.initAgent();

        // 验证 REST API 连接
        try {
            const response = await this.apiClient.get('/users/me', {
                httpsAgent: this.agent,
            });
            console.log(`[Zulip] REST API 连接成功，用户: ${response.data.email}`);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[Zulip] REST API 连接失败:', (error as { response?: { data?: unknown } }).response?.data || err.message);
            throw error;
        }

        // 启动 WebSocket 连接
        if (this.config.websocket?.enabled !== false) {
            await this.connectWebSocket();
        }

        this.emit('ready');
    }

    /**
     * 连接 WebSocket
     */
    private async connectWebSocket(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // 获取 WebSocket URL
                const wsUrl = this.config.serverUrl.replace(/^http/, 'ws') + '/api/v1/events';
                const auth = Buffer.from(`${this.config.email}:${this.config.apiKey}`).toString('base64');

                const wsOptions: WebSocket.ClientOptions = {
                    headers: {
                        'Authorization': `Basic ${auth}`,
                    },
                };

                if (this.agent) {
                    wsOptions.agent = this.agent;
                }

                this.ws = new WebSocket(wsUrl, wsOptions);

                this.ws.on('open', () => {
                    console.log('[Zulip] WebSocket 连接成功');
                    this.isConnected = true;
                    resolve();
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    try {
                        const event = JSON.parse(data.toString()) as ZulipWebSocketEvent;
                        this.handleWebSocketEvent(event);
                    } catch (error) {
                        console.error('[Zulip] 解析 WebSocket 消息失败:', error);
                    }
                });

                this.ws.on('error', (error) => {
                    console.error('[Zulip] WebSocket 错误:', error);
                    this.isConnected = false;
                    reject(error);
                });

                this.ws.on('close', () => {
                    console.log('[Zulip] WebSocket 连接已关闭');
                    this.isConnected = false;
                    this.connectionManager.scheduleReconnect();
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 处理 WebSocket 事件
     */
    private handleWebSocketEvent(event: ZulipWebSocketEvent): void {
        if (event.type === 'message') {
            this.emit('message', event as ZulipMessageEvent);
        } else if (event.type === 'update_message') {
            this.emit('update_message', event);
        } else if (event.type === 'delete_message') {
            this.emit('delete_message', event);
        } else if (event.type === 'reaction') {
            this.emit('reaction', event);
        } else if (event.type === 'heartbeat') {
            // 心跳，无需处理
        } else {
            this.emit('event', event);
        }
    }

    /**
     * 发送消息
     */
    async sendMessage(params: ZulipSendMessageParams): Promise<ZulipAPIResponse> {
        await this.initAgent();

        const formData = new URLSearchParams();
        formData.append('type', params.type);
        formData.append('content', params.content);

        if (params.type === 'stream') {
            if (params.to) {
                formData.append('to', params.to);
            }
            if (params.topic) {
                formData.append('topic', params.topic);
            }
        } else if (params.type === 'private') {
            if (params.to_emails) {
                formData.append('to', JSON.stringify(params.to_emails));
            }
        }

        if (params.client) {
            formData.append('client', params.client);
        }

        try {
            const response = await this.apiClient.post('/messages', formData.toString(), {
                httpsAgent: this.agent,
            });
            return response.data;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[Zulip] 发送消息失败:', (error as { response?: { data?: unknown } }).response?.data || err.message);
            throw error;
        }
    }

    /**
     * 更新消息
     */
    async updateMessage(messageId: number, content: string, topic?: string): Promise<ZulipAPIResponse> {
        await this.initAgent();

        const formData = new URLSearchParams();
        formData.append('message_id', messageId.toString());
        formData.append('content', content);
        // topic 参数是可选的，用于更新流消息的话题
        if (topic) {
            formData.append('topic', topic);
        }

        try {
            const response = await this.apiClient.patch('/messages/' + messageId, formData.toString(), {
                httpsAgent: this.agent,
            });
            return response.data;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[Zulip] 更新消息失败:', (error as { response?: { data?: unknown } }).response?.data || err.message);
            throw error;
        }
    }

    /**
     * 删除消息
     */
    async deleteMessage(messageId: number): Promise<ZulipAPIResponse> {
        await this.initAgent();

        try {
            const response = await this.apiClient.delete('/messages/' + messageId, {
                httpsAgent: this.agent,
            });
            return response.data;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[Zulip] 删除消息失败:', (error as { response?: { data?: unknown } }).response?.data || err.message);
            throw error;
        }
    }

    /**
     * 获取流列表
     */
    async getStreams(): Promise<ZulipStreamsResponse> {
        await this.initAgent();

        try {
            const response = await this.apiClient.get('/streams', {
                httpsAgent: this.agent,
            });
            return response.data;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[Zulip] 获取流列表失败:', (error as { response?: { data?: unknown } }).response?.data || err.message);
            throw error;
        }
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(userId: number): Promise<ZulipUserResponse> {
        await this.initAgent();

        try {
            const response = await this.apiClient.get(`/users/${userId}`, {
                httpsAgent: this.agent,
            });
            return response.data;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[Zulip] 获取用户信息失败:', (error as { response?: { data?: unknown } }).response?.data || err.message);
            throw error;
        }
    }

    /**
     * 获取当前用户信息
     */
    async getMe(): Promise<ZulipUser> {
        await this.initAgent();

        try {
            const response = await this.apiClient.get('/users/me', {
                httpsAgent: this.agent,
            });
            return response.data;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[Zulip] 获取当前用户信息失败:', (error as { response?: { data?: unknown } }).response?.data || err.message);
            throw error;
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        this.connectionManager.stop();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
        this.emit('stop');
    }
}

