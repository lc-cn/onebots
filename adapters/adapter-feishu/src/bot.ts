/**
 * 飞书 Bot 客户端
 * 基于飞书开放平台 API，使用 fetch 实现
 */
import { EventEmitter } from 'events';
import type { RouterContext, Next } from 'onebots';
import {
    FeishuEndpoint,
    type FeishuConfig,
    type FeishuTokenResponse,
    type FeishuSendMessageRequest,
    type FeishuSendMessageResponse,
    type FeishuEvent,
    type FeishuUser,
    type FeishuChat,
    type FeishuWebhookBody,
    type FeishuAPIResponse,
    type FeishuUserAPIResponse,
    type FeishuChatAPIResponse,
    type FeishuChatMembersAPIResponse,
} from './types.js';

/**
 * HTTP 请求选项
 */
interface RequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    params?: Record<string, string | number | boolean>;
    skipAuth?: boolean;
}

export class FeishuBot extends EventEmitter {
    private config: FeishuConfig;
    private tenantAccessToken: string = '';
    private tokenExpireTime: number = 0;
    private me: FeishuUser | null = null;
    /** 当前使用的 API 端点 */
    readonly endpoint: string;

    constructor(config: FeishuConfig) {
        super();
        this.config = config;
        // 使用配置的端点，默认为飞书（国内版）
        this.endpoint = config.endpoint || FeishuEndpoint.FEISHU;
    }

    /**
     * 发送 HTTP 请求
     */
    private async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
        const { method = 'GET', headers = {}, body, params, skipAuth = false } = options;
        
        // 构建 URL
        let url = `${this.endpoint}${path}`;
        if (params) {
            const searchParams = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                searchParams.append(key, String(value));
            }
            url += `?${searchParams.toString()}`;
        }

        // 构建请求头
        const requestHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            ...headers,
        };

        // 添加认证 token（除了获取 token 的请求）
        if (!skipAuth) {
            const token = await this.getTenantAccessToken();
            requestHeaders['Authorization'] = `Bearer ${token}`;
        }

        // 发送请求
        const response = await fetch(url, {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : undefined,
        });

        return response.json();
    }

    /**
     * GET 请求
     */
    async get<T = unknown>(path: string, params?: Record<string, string | number | boolean>): Promise<{ data: T }> {
        const data = await this.request<T>(path, { params });
        return { data };
    }

    /**
     * POST 请求
     */
    async post<T = unknown>(path: string, body?: string | Record<string, unknown>, params?: Record<string, string | number | boolean>): Promise<{ data: T }> {
        const data = await this.request<T>(path, { method: 'POST', body, params });
        return { data };
    }

    /**
     * PUT 请求
     */
    async put<T = unknown>(path: string, body?: string | Record<string, unknown>): Promise<{ data: T }> {
        const data = await this.request<T>(path, { method: 'PUT', body });
        return { data };
    }

    /**
     * DELETE 请求
     */
    async delete<T = unknown>(path: string): Promise<{ data: T }> {
        const data = await this.request<T>(path, { method: 'DELETE' });
        return { data };
    }

    /**
     * 获取租户访问令牌
     */
    async getTenantAccessToken(): Promise<string> {
        if (this.tenantAccessToken && Date.now() < this.tokenExpireTime) {
            return this.tenantAccessToken;
        }

        const data = await this.request<FeishuTokenResponse>('/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            body: {
                app_id: this.config.app_id,
                app_secret: this.config.app_secret,
            },
            skipAuth: true,
        });

        if (data.code !== 0) {
            throw new Error(`获取租户访问令牌失败: ${data.msg}`);
        }

        this.tenantAccessToken = data.tenant_access_token || '';
        this.tokenExpireTime = Date.now() + (data.expire - 60) * 1000; // 提前60秒刷新

        return this.tenantAccessToken;
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        try {
            // 获取访问令牌
            await this.getTenantAccessToken();
            
            // 获取 Bot 信息
            this.me = await this.getBotInfo();
            
            this.emit('ready');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        this.emit('stopped');
    }

    /**
     * 处理 Webhook 请求
     */
    async handleWebhook(ctx: RouterContext, next: Next): Promise<void> {
        const body = ctx.request.body as FeishuWebhookBody;
        
        // 验证事件（如果配置了 verification_token）
        if (this.config.verification_token && body.header?.token !== this.config.verification_token) {
            ctx.status = 401;
            ctx.body = { error: 'Invalid token' };
            return;
        }

        // 处理 URL 验证（飞书首次配置 webhook 时会发送验证请求）
        if (body.type === 'url_verification') {
            ctx.body = { challenge: body.challenge };
            return;
        }

        // 处理事件
        const event = body as unknown as FeishuEvent;
        this.emit('event', event);

        ctx.body = { code: 0 };
        await next();
    }

    /**
     * 获取缓存的 Bot 信息
     */
    getCachedMe(): FeishuUser | null {
        return this.me;
    }

    /**
     * 获取 Bot 信息
     */
    async getBotInfo(): Promise<FeishuUser> {
        const response = await this.get<FeishuAPIResponse>('/im/v1/bots', { page_size: 1 });

        if (response.data.code !== 0) {
            throw new Error(`获取 Bot 信息失败: ${response.data.msg}`);
        }

        // 飞书没有直接的 getBotInfo API，这里返回一个占位信息
        return {
            user_id: this.config.app_id,
            open_id: this.config.app_id,
            name: 'Feishu Bot',
        };
    }

    /**
     * 发送消息
     */
    async sendMessage(receiveId: string, receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id', content: string | Record<string, unknown>, msgType: string = 'text'): Promise<FeishuSendMessageResponse> {
        const request: FeishuSendMessageRequest = {
            receive_id: receiveId,
            receive_id_type: receiveIdType,
            msg_type: msgType as FeishuSendMessageRequest['msg_type'],
            content: typeof content === 'string' ? JSON.stringify({ text: content }) : JSON.stringify(content),
        };

        const response = await this.post<FeishuSendMessageResponse>('/im/v1/messages', request as unknown as Record<string, unknown>, {
            receive_id_type: receiveIdType,
        });

        if (response.data.code !== 0) {
            throw new Error(`发送消息失败: ${response.data.msg}`);
        }

        return response.data;
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(userId: string, userIdType: 'open_id' | 'user_id' | 'union_id' = 'open_id'): Promise<FeishuUser> {
        const response = await this.get<FeishuUserAPIResponse>(`/contact/v3/users/${userId}`, {
            user_id_type: userIdType,
        });

        if (response.data.code !== 0 || !response.data.data?.user) {
            throw new Error(`获取用户信息失败: ${response.data.msg}`);
        }

        return response.data.data.user;
    }

    /**
     * 获取群组信息
     */
    async getChatInfo(chatId: string): Promise<FeishuChat> {
        const response = await this.get<FeishuChatAPIResponse>(`/im/v1/chats/${chatId}`);

        if (response.data.code !== 0 || !response.data.data) {
            throw new Error(`获取群组信息失败: ${response.data.msg}`);
        }

        return response.data.data as FeishuChat;
    }

    /**
     * 获取群组成员列表
     */
    async getChatMembers(chatId: string): Promise<FeishuUser[]> {
        const response = await this.get<FeishuChatMembersAPIResponse>(`/im/v1/chats/${chatId}/members`);

        if (response.data.code !== 0 || !response.data.data) {
            throw new Error(`获取群组成员列表失败: ${response.data.msg}`);
        }

        return response.data.data.items || [];
    }

    /**
     * 获取 HTTP 客户端实例（返回 this 以便链式调用）
     */
    getHttpClient(): FeishuBot {
        return this;
    }
}
