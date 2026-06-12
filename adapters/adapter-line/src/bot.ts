/**
 * Line Bot 客户端
 * 轻量版实现，直接封装 Line Messaging API
 * 支持 Node.js 和 Cloudflare Workers
 */

import { EventEmitter } from 'events';
import { createHmac } from 'crypto';
import { buildProxyUrl, maskProxyUrl, createHttpsProxyAgent } from 'onebots';
import type {
    LineConfig,
    WebhookEvent,
    MessageEvent,
    UserProfile,
    GroupSummary,
    GroupMemberProfile,
    GroupMemberCount,
    SendMessage,
    SendMessageResponse,
} from './types.js';
const LINE_API_BASE = 'https://api.line.me/v2';
const LINE_API_DATA = 'https://api-data.line.me/v2';

/**
 * 检测是否为 Node.js 环境
 */
function isNode(): boolean {
    return typeof process !== 'undefined' && process.versions?.node !== undefined;
}

/**
 * Line Bot 客户端
 */
export class LineBot extends EventEmitter {
    private config: LineConfig;
    private agent: any = null;
    private initialized = false;

    constructor(config: LineConfig) {
        super();
        this.config = config;
    }

    /**
     * 初始化代理 Agent
     */
    private async initAgent(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;

        if (!this.config.proxy?.url || !isNode()) return;

        const agent = await createHttpsProxyAgent(this.config.proxy);
        if (agent) {
            this.agent = agent;
            console.log(`[LineBot] 已配置代理: ${maskProxyUrl(buildProxyUrl(this.config.proxy))}`);
        } else {
            console.warn('[LineBot] https-proxy-agent 未安装，将直接连接');
        }
    }

    // ============================================
    // HTTP 请求
    // ============================================

    /**
     * Node.js 原生 HTTPS 请求
     */
    private nodeRequest<T>(url: string, options: {
        method: string;
        headers: Record<string, string>;
        body?: string;
    }): Promise<T> {
        return new Promise(async (resolve, reject) => {
            const https = await import('https');
            const urlObj = new URL(url);

            const reqOptions: any = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                method: options.method,
                headers: options.headers,
            };

            if (this.agent) {
                reqOptions.agent = this.agent;
            }

            const req = https.request(reqOptions, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200 || res.statusCode === 201) {
                        try {
                            resolve(data ? JSON.parse(data) : {} as T);
                        } catch {
                            resolve(data as T);
                        }
                    } else if (res.statusCode === 204) {
                        resolve({} as T);
                    } else {
                        let errorMsg = `Line API Error: ${res.statusCode}`;
                        try {
                            const errorData = JSON.parse(data);
                            errorMsg += ` - ${JSON.stringify(errorData)}`;
                        } catch {
                            errorMsg += ` - ${data}`;
                        }
                        reject(new Error(errorMsg));
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (options.body) {
                req.write(options.body);
            }

            req.end();
        });
    }

    /**
     * Fetch 请求（Cloudflare Workers）
     */
    private async fetchRequest<T>(url: string, options: {
        method: string;
        headers: Record<string, string>;
        body?: string;
    }): Promise<T> {
        const response = await fetch(url, {
            method: options.method,
            headers: options.headers,
            body: options.body,
        });

        if (response.status === 204) {
            return {} as T;
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(`Line API Error: ${response.status} - ${JSON.stringify(error)}`);
        }

        return response.json();
    }

    /**
     * 发送 API 请求
     */
    async request<T = any>(
        endpoint: string,
        options: {
            method?: string;
            body?: any;
            baseUrl?: string;
        } = {}
    ): Promise<T> {
        await this.initAgent();

        const { method = 'GET', body, baseUrl = LINE_API_BASE } = options;
        const url = `${baseUrl}${endpoint}`;

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.config.channel_access_token}`,
            'Content-Type': 'application/json',
        };

        const requestBody = body ? JSON.stringify(body) : undefined;

        if (isNode()) {
            return this.nodeRequest<T>(url, { method, headers, body: requestBody });
        }

        return this.fetchRequest<T>(url, { method, headers, body: requestBody });
    }

    // ============================================
    // Webhook 签名验证
    // ============================================

    /**
     * 验证 Webhook 签名
     */
    validateSignature(body: string, signature: string): boolean {
        const hash = createHmac('sha256', this.config.channel_secret)
            .update(body)
            .digest('base64');
        return hash === signature;
    }

    /**
     * 处理 Webhook 请求
     */
    async handleWebhook(body: string, signature: string): Promise<void> {
        // 验证签名
        if (!this.validateSignature(body, signature)) {
            throw new Error('Invalid signature');
        }

        const data = JSON.parse(body);
        const events: WebhookEvent[] = data.events || [];

        for (const event of events) {
            this.emit('event', event);
            this.emit(event.type, event);
        }
    }

    // ============================================
    // 消息发送
    // ============================================

    /**
     * 回复消息
     */
    async replyMessage(replyToken: string, messages: SendMessage | SendMessage[]): Promise<SendMessageResponse> {
        const messageArray = Array.isArray(messages) ? messages : [messages];
        return this.request<SendMessageResponse>('/bot/message/reply', {
            method: 'POST',
            body: {
                replyToken,
                messages: messageArray,
            },
        });
    }

    /**
     * 推送消息给用户
     */
    async pushMessage(to: string, messages: SendMessage | SendMessage[]): Promise<SendMessageResponse> {
        const messageArray = Array.isArray(messages) ? messages : [messages];
        return this.request<SendMessageResponse>('/bot/message/push', {
            method: 'POST',
            body: {
                to,
                messages: messageArray,
            },
        });
    }

    /**
     * 多播消息（发送给多个用户）
     */
    async multicast(to: string[], messages: SendMessage | SendMessage[]): Promise<void> {
        const messageArray = Array.isArray(messages) ? messages : [messages];
        await this.request('/bot/message/multicast', {
            method: 'POST',
            body: {
                to,
                messages: messageArray,
            },
        });
    }

    /**
     * 广播消息（发送给所有好友）
     */
    async broadcast(messages: SendMessage | SendMessage[]): Promise<void> {
        const messageArray = Array.isArray(messages) ? messages : [messages];
        await this.request('/bot/message/broadcast', {
            method: 'POST',
            body: {
                messages: messageArray,
            },
        });
    }

    /**
     * 发送文本消息
     */
    async sendText(to: string, text: string): Promise<SendMessageResponse> {
        return this.pushMessage(to, { type: 'text', text });
    }

    /**
     * 回复文本消息
     */
    async replyText(replyToken: string, text: string): Promise<SendMessageResponse> {
        return this.replyMessage(replyToken, { type: 'text', text });
    }

    /**
     * 发送图片消息
     */
    async sendImage(to: string, originalUrl: string, previewUrl?: string): Promise<SendMessageResponse> {
        return this.pushMessage(to, {
            type: 'image',
            originalContentUrl: originalUrl,
            previewImageUrl: previewUrl || originalUrl,
        });
    }

    /**
     * 发送视频消息
     */
    async sendVideo(to: string, originalUrl: string, previewUrl: string): Promise<SendMessageResponse> {
        return this.pushMessage(to, {
            type: 'video',
            originalContentUrl: originalUrl,
            previewImageUrl: previewUrl,
        });
    }

    /**
     * 发送音频消息
     */
    async sendAudio(to: string, originalUrl: string, duration: number): Promise<SendMessageResponse> {
        return this.pushMessage(to, {
            type: 'audio',
            originalContentUrl: originalUrl,
            duration,
        });
    }

    /**
     * 发送位置消息
     */
    async sendLocation(to: string, title: string, address: string, latitude: number, longitude: number): Promise<SendMessageResponse> {
        return this.pushMessage(to, {
            type: 'location',
            title,
            address,
            latitude,
            longitude,
        });
    }

    /**
     * 发送贴图消息
     */
    async sendSticker(to: string, packageId: string, stickerId: string): Promise<SendMessageResponse> {
        return this.pushMessage(to, {
            type: 'sticker',
            packageId,
            stickerId,
        });
    }

    // ============================================
    // 用户资料
    // ============================================

    /**
     * 获取用户资料
     */
    async getProfile(userId: string): Promise<UserProfile> {
        return this.request<UserProfile>(`/bot/profile/${userId}`);
    }

    /**
     * 获取群组成员资料
     */
    async getGroupMemberProfile(groupId: string, userId: string): Promise<GroupMemberProfile> {
        return this.request<GroupMemberProfile>(`/bot/group/${groupId}/member/${userId}`);
    }

    /**
     * 获取聊天室成员资料
     */
    async getRoomMemberProfile(roomId: string, userId: string): Promise<GroupMemberProfile> {
        return this.request<GroupMemberProfile>(`/bot/room/${roomId}/member/${userId}`);
    }

    // ============================================
    // 群组管理
    // ============================================

    /**
     * 获取群组信息
     */
    async getGroupSummary(groupId: string): Promise<GroupSummary> {
        return this.request<GroupSummary>(`/bot/group/${groupId}/summary`);
    }

    /**
     * 获取群组成员数量
     */
    async getGroupMemberCount(groupId: string): Promise<GroupMemberCount> {
        return this.request<GroupMemberCount>(`/bot/group/${groupId}/members/count`);
    }

    /**
     * 获取群组成员 ID 列表
     */
    async getGroupMemberIds(groupId: string, start?: string): Promise<{ memberIds: string[]; next?: string }> {
        const query = start ? `?start=${start}` : '';
        return this.request(`/bot/group/${groupId}/members/ids${query}`);
    }

    /**
     * 离开群组
     */
    async leaveGroup(groupId: string): Promise<void> {
        await this.request(`/bot/group/${groupId}/leave`, { method: 'POST' });
    }

    /**
     * 离开聊天室
     */
    async leaveRoom(roomId: string): Promise<void> {
        await this.request(`/bot/room/${roomId}/leave`, { method: 'POST' });
    }

    // ============================================
    // 内容获取
    // ============================================

    /**
     * 获取消息内容（图片、视频、音频、文件）
     * 返回 ArrayBuffer
     */
    async getMessageContent(messageId: string): Promise<ArrayBuffer> {
        await this.initAgent();

        const url = `${LINE_API_DATA}/bot/message/${messageId}/content`;
        const headers = {
            'Authorization': `Bearer ${this.config.channel_access_token}`,
        };

        if (isNode()) {
            return new Promise(async (resolve, reject) => {
                const https = await import('https');
                const urlObj = new URL(url);

                const reqOptions: any = {
                    hostname: urlObj.hostname,
                    port: 443,
                    path: urlObj.pathname,
                    method: 'GET',
                    headers,
                };

                if (this.agent) {
                    reqOptions.agent = this.agent;
                }

                const req = https.request(reqOptions, (res) => {
                    const chunks: Buffer[] = [];

                    res.on('data', (chunk) => {
                        chunks.push(chunk);
                    });

                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            const buffer = Buffer.concat(chunks);
                            resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
                        } else {
                            reject(new Error(`Failed to get content: ${res.statusCode}`));
                        }
                    });
                });

                req.on('error', reject);
                req.end();
            });
        }

        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`Failed to get content: ${response.status}`);
        }
        return response.arrayBuffer();
    }

    // ============================================
    // Bot 信息
    // ============================================

    /**
     * 获取 Bot 信息
     */
    async getBotInfo(): Promise<{
        userId: string;
        basicId: string;
        premiumId?: string;
        displayName: string;
        pictureUrl?: string;
        chatMode: 'chat' | 'bot';
        markAsReadMode: 'auto' | 'manual';
    }> {
        return this.request('/bot/info');
    }

    // ============================================
    // 配额相关
    // ============================================

    /**
     * 获取本月消息配额
     */
    async getMessageQuota(): Promise<{
        type: 'none' | 'limited' | 'unlimited';
        value?: number;
    }> {
        return this.request('/bot/message/quota');
    }

    /**
     * 获取本月已发送消息数量
     */
    async getMessageQuotaConsumption(): Promise<{
        totalUsage: number;
    }> {
        return this.request('/bot/message/quota/consumption');
    }
}

