/**
 * WhatsApp Bot 客户端
 * 基于 WhatsApp Business API (Meta Graph API)
 */
import { EventEmitter } from 'events';
import axios, { AxiosInstance } from 'axios';
import { createRequire } from 'module';
import type {
    WhatsAppConfig,
    WhatsAppSendMessageParams,
    WhatsAppAPIResponse,
    WhatsAppWebhookEvent,
    WhatsAppMessageEvent,
    ProxyConfig,
} from './types.js';
import { buildProxyUrl, maskProxyUrl, createHttpsProxyAgent } from '@onebots/core';

const require = createRequire(import.meta.url);

export class WhatsAppBot extends EventEmitter {
    private config: WhatsAppConfig;
    private apiClient: AxiosInstance;
    private agent: any = null;
    private initialized: boolean = false;

    constructor(config: WhatsAppConfig) {
        super();
        this.config = config;
        this.apiClient = this.createAPIClient();
    }

    /**
     * 创建 API 客户端
     */
    private createAPIClient(): AxiosInstance {
        const apiVersion = this.config.apiVersion || 'v21.0';
        const baseURL = `https://graph.facebook.com/${apiVersion}/${this.config.phoneNumberId}`;

        const client = axios.create({
            baseURL,
            headers: {
                'Authorization': `Bearer ${this.config.accessToken}`,
                'Content-Type': 'application/json',
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

        const agent = await createHttpsProxyAgent(this.config.proxy);
        if (agent) {
            this.agent = agent;
            console.log(`[WhatsApp] 已配置代理: ${maskProxyUrl(buildProxyUrl(this.config.proxy))}`);
        } else {
            console.warn('[WhatsApp] 创建代理失败，将直接连接');
        }
    }

    /**
     * 启动 Bot（验证连接）
     */
    async start(): Promise<void> {
        await this.initAgent();
        
        // 验证连接
        try {
            await this.apiClient.get('/');
            console.log('[WhatsApp] 连接验证成功');
            this.emit('ready');
        } catch (error: any) {
            console.error('[WhatsApp] 连接验证失败:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        this.emit('stop');
    }

    /**
     * 发送消息
     */
    async sendMessage(params: WhatsAppSendMessageParams): Promise<WhatsAppAPIResponse> {
        await this.initAgent();

        const payload: any = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: params.to,
            type: params.type,
        };

        // 根据消息类型添加内容
        if (params.type === 'text' && params.text) {
            payload.text = params.text;
        } else if (params.type === 'image' && params.image) {
            payload.image = params.image;
        } else if (params.type === 'video' && params.video) {
            payload.video = params.video;
        } else if (params.type === 'audio' && params.audio) {
            payload.audio = params.audio;
        } else if (params.type === 'document' && params.document) {
            payload.document = params.document;
        } else if (params.type === 'location' && params.location) {
            payload.location = params.location;
        } else if (params.type === 'contacts' && params.contacts) {
            payload.contacts = params.contacts;
        }
        if (params.context) {
            payload.context = params.context;
        }

        try {
            const response = await this.apiClient.post('/messages', payload, {
                httpsAgent: this.agent,
            });
            return response.data;
        } catch (error: any) {
            console.error('[WhatsApp] 发送消息失败:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * 处理 Webhook 事件
     */
    handleWebhook(event: WhatsAppWebhookEvent): void {
        for (const entry of event.entry) {
            for (const change of entry.changes) {
                if (change.field === 'messages') {
                    const value = change.value;
                    
                    // 处理收到的消息
                    if (value.messages) {
                        for (const message of value.messages) {
                            this.emit('message', message, value.metadata);
                        }
                    }

                    // 处理消息状态更新
                    if (value.statuses) {
                        for (const status of value.statuses) {
                            this.emit('status', status);
                        }
                    }
                }
            }
        }
    }

    /**
     * 验证 Webhook
     */
    verifyWebhook(mode: string, token: string, challenge: string): string | null {
        if (mode === 'subscribe' && token === this.config.webhookVerifyToken) {
            return challenge;
        }
        return null;
    }

    /**
     * 获取媒体 URL
     */
    async getMediaUrl(mediaId: string): Promise<string> {
        await this.initAgent();

        try {
            const response = await this.apiClient.get(`/${mediaId}`, {
                httpsAgent: this.agent,
            });
            return response.data.url;
        } catch (error: any) {
            console.error('[WhatsApp] 获取媒体 URL 失败:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * 下载媒体
     */
    async downloadMedia(mediaId: string): Promise<Buffer> {
        const url = await this.getMediaUrl(mediaId);
        
        try {
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${this.config.accessToken}`,
                },
                responseType: 'arraybuffer',
                httpsAgent: this.agent,
            });
            return Buffer.from(response.data);
        } catch (error: any) {
            console.error('[WhatsApp] 下载媒体失败:', error.message);
            throw error;
        }
    }
}

