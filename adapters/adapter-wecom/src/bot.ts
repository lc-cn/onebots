/**
 * 企业微信 Bot 客户端
 * 基于企业微信开放平台 API，使用 fetch 实现
 */
import { EventEmitter } from 'events';
import type { RouterContext, Next } from 'onebots';
import type {
    WeComConfig,
    WeComTokenResponse,
    WeComSendMessageRequest,
    WeComSendMessageResponse,
    WeComEvent,
    WeComUser,
    WeComDepartment,
    WeComUserResponse,
    WeComDepartmentListResponse,
    WeComDepartmentMembersResponse,
} from './types.js';

const WECOM_API_BASE = 'https://qyapi.weixin.qq.com';

/**
 * HTTP 请求选项
 */
interface RequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    params?: Record<string, string | number | boolean>;
    skipAuth?: boolean;
}

export class WeComBot extends EventEmitter {
    private config: WeComConfig;
    private accessToken: string = '';
    private tokenExpireTime: number = 0;
    private me: WeComUser | null = null;

    constructor(config: WeComConfig) {
        super();
        this.config = config;
    }

    /**
     * 发送 HTTP 请求
     */
    private async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
        const { method = 'GET', headers = {}, body, params, skipAuth = false } = options;
        
        // 构建 URL
        const url = new URL(`${WECOM_API_BASE}${path}`);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined) {
                    url.searchParams.append(key, String(value));
                }
            }
        }

        // 自动添加 token（除了获取 token 的请求）
        if (!skipAuth && !path.includes('/gettoken')) {
            const token = await this.getAccessToken();
            url.searchParams.append('access_token', token);
        }

        // 构建请求头
        const requestHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            ...headers,
        };

        // 发送请求
        const response = await fetch(url.toString(), {
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
    async post<T = unknown>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean>): Promise<{ data: T }> {
        const data = await this.request<T>(path, { method: 'POST', body, params });
        return { data };
    }

    /**
     * 获取访问令牌
     */
    async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpireTime) {
            return this.accessToken;
        }

        const data = await this.request<WeComTokenResponse>('/cgi-bin/gettoken', {
            params: {
                corpid: this.config.corp_id,
                corpsecret: this.config.corp_secret,
            },
            skipAuth: true,
        });

        if (data.errcode !== 0) {
            throw new Error(`获取访问令牌失败: ${data.errmsg}`);
        }

        this.accessToken = data.access_token || '';
        this.tokenExpireTime = Date.now() + ((data.expires_in || 7200) - 60) * 1000; // 提前60秒刷新

        return this.accessToken;
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        try {
            // 获取访问令牌
            await this.getAccessToken();
            
            // 获取应用信息（企业微信没有直接的 getBotInfo API）
            this.me = {
                userid: this.config.agent_id,
                name: 'WeCom Bot',
            };
            
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
     * 处理 Webhook 请求（事件回调）
     */
    async handleWebhook(ctx: RouterContext, next: Next): Promise<void> {
        const body = ctx.request.body as Record<string, unknown> | undefined;
        const query = ctx.query;
        
        // 处理 URL 验证（企业微信首次配置 webhook 时会发送验证请求）
        if (query.msg_signature && query.timestamp && query.nonce && query.echostr) {
            // 这里需要验证签名，简化处理直接返回 echostr
            ctx.body = query.echostr;
            return;
        }

        // 处理事件
        if (body && typeof body.EventType === 'string') {
            const event = body as unknown as WeComEvent;
            this.emit('event', event);
        }

        ctx.body = { code: 0 };
        await next();
    }

    /**
     * 获取缓存的 Bot 信息
     */
    getCachedMe(): WeComUser | null {
        return this.me;
    }

    /**
     * 发送应用消息
     */
    async sendMessage(request: WeComSendMessageRequest): Promise<WeComSendMessageResponse> {
        const response = await this.post<WeComSendMessageResponse>('/cgi-bin/message/send', {
            ...request,
            agentid: parseInt(this.config.agent_id),
        });

        if (response.data.errcode !== 0) {
            throw new Error(`发送消息失败: ${response.data.errmsg}`);
        }

        return response.data;
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(userId: string): Promise<WeComUser> {
        const response = await this.get<WeComUserResponse>('/cgi-bin/user/get', { userid: userId });

        if (response.data.errcode !== 0) {
            throw new Error(`获取用户信息失败: ${response.data.errmsg}`);
        }

        return response.data;
    }

    /**
     * 获取部门列表
     */
    async getDepartmentList(departmentId?: number): Promise<WeComDepartment[]> {
        const params: Record<string, string | number | boolean> = {};
        if (departmentId !== undefined) {
            params.id = departmentId;
        }
        
        const response = await this.get<WeComDepartmentListResponse>('/cgi-bin/department/list', params);

        if (response.data.errcode !== 0) {
            throw new Error(`获取部门列表失败: ${response.data.errmsg}`);
        }

        return response.data.department || [];
    }

    /**
     * 获取部门成员列表
     */
    async getDepartmentMembers(departmentId: number, fetchChild?: boolean): Promise<WeComUser[]> {
        const response = await this.get<WeComDepartmentMembersResponse>('/cgi-bin/user/list', {
            department_id: departmentId,
            fetch_child: fetchChild ? 1 : 0,
        });

        if (response.data.errcode !== 0) {
            throw new Error(`获取部门成员列表失败: ${response.data.errmsg}`);
        }

        return response.data.userlist || [];
    }

    /**
     * 获取 HTTP 客户端实例（返回 this 以便链式调用）
     */
    getHttpClient(): WeComBot {
        return this;
    }
}
