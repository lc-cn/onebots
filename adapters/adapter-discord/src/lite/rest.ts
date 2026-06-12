/**
 * Discord REST API 轻量封装
 * Node.js 使用原生 https 模块，Cloudflare Workers 使用 fetch
 */

const DISCORD_API_BASE = 'https://discord.com/api/v10';
import { buildProxyUrl, maskProxyUrl, createHttpsProxyAgent } from '@onebots/core';

export interface RESTOptions {
    token: string;
    proxy?: {
        url: string;
        username?: string;
        password?: string;
    };
}

export interface RequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: any;
    headers?: Record<string, string>;
    query?: Record<string, string>;
}

/**
 * 检测是否为 Node.js 环境
 */
function isNode(): boolean {
    return typeof process !== 'undefined' && process.versions?.node !== undefined;
}

/**
 * 轻量版 Discord REST 客户端
 */
export class DiscordREST {
    private token: string;
    private proxyUrl?: string;
    private agent: any = null;
    private initialized = false;

    constructor(options: RESTOptions) {
        this.token = options.token;
        
        if (options.proxy?.url) {
            this.proxyUrl = buildProxyUrl(options.proxy);
        }
    }

    /**
     * 初始化代理 Agent（延迟加载）
     */
    private async initAgent(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;

        if (!this.proxyUrl || !isNode()) return;

        const agent = await createHttpsProxyAgent({ url: this.proxyUrl });
        if (agent) {
            this.agent = agent;
            console.log(`[DiscordREST] 已配置代理: ${maskProxyUrl(this.proxyUrl)}`);
        } else {
            console.warn('[DiscordREST] https-proxy-agent 未安装，将直接连接');
        }
    }

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

            // 添加代理 agent
            if (this.agent) {
                reqOptions.agent = this.agent;
            }

            const req = https.request(reqOptions, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 204) {
                        resolve(undefined as T);
                        return;
                    }

                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(data ? JSON.parse(data) : undefined);
                        } catch {
                            resolve(data as T);
                        }
                    } else {
                        let errorMsg = `Discord API Error: ${res.statusCode}`;
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

            req.on('error', (error) => {
                reject(error);
            });

            // 设置超时
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
     * Fetch 请求（Cloudflare Workers 等环境）
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
            return undefined as T;
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(`Discord API Error: ${response.status} - ${JSON.stringify(error)}`);
        }

        return response.json();
    }

    /**
     * 发送请求
     */
    async request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
        // 初始化代理
        await this.initAgent();

        const { method = 'GET', body, headers = {}, query } = options;
        
        let url = `${DISCORD_API_BASE}${endpoint}`;
        if (query) {
            const filteredQuery = Object.fromEntries(
                Object.entries(query).filter(([_, v]) => v !== undefined)
            );
            if (Object.keys(filteredQuery).length > 0) {
                const params = new URLSearchParams(filteredQuery);
                url += `?${params.toString()}`;
            }
        }

        const requestHeaders: Record<string, string> = {
            'Authorization': `Bot ${this.token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'OneBots Discord Lite (https://github.com/lc-cn/onebots)',
            ...headers,
        };

        const requestBody = body ? JSON.stringify(body) : undefined;

        // Node.js 环境使用原生 https 模块（支持 agent）
        if (isNode()) {
            return this.nodeRequest<T>(url, {
                method,
                headers: requestHeaders,
                body: requestBody,
            });
        }

        // 其他环境（Cloudflare Workers 等）使用 fetch
        return this.fetchRequest<T>(url, {
            method,
            headers: requestHeaders,
            body: requestBody,
        });
    }

    // ============================================
    // 用户相关
    // ============================================

    /** 获取当前用户 */
    async getCurrentUser() {
        return this.request('/users/@me');
    }

    /** 获取用户 */
    async getUser(userId: string) {
        return this.request(`/users/${userId}`);
    }

    // ============================================
    // 频道相关
    // ============================================

    /** 获取频道 */
    async getChannel(channelId: string) {
        return this.request(`/channels/${channelId}`);
    }

    /** 发送消息 */
    async createMessage(channelId: string, content: string | { content?: string; embeds?: any[]; components?: any[] }) {
        const body = typeof content === 'string' ? { content } : content;
        return this.request(`/channels/${channelId}/messages`, {
            method: 'POST',
            body,
        });
    }

    /** 编辑消息 */
    async editMessage(channelId: string, messageId: string, content: string | { content?: string; embeds?: any[] }) {
        const body = typeof content === 'string' ? { content } : content;
        return this.request(`/channels/${channelId}/messages/${messageId}`, {
            method: 'PATCH',
            body,
        });
    }

    /** 删除消息 */
    async deleteMessage(channelId: string, messageId: string) {
        return this.request(`/channels/${channelId}/messages/${messageId}`, {
            method: 'DELETE',
        });
    }

    /** 获取消息 */
    async getMessage(channelId: string, messageId: string) {
        return this.request(`/channels/${channelId}/messages/${messageId}`);
    }

    /** 获取消息历史 */
    async getMessages(channelId: string, options?: { limit?: number; before?: string; after?: string; around?: string }) {
        return this.request(`/channels/${channelId}/messages`, {
            query: options as Record<string, string>,
        });
    }

    // ============================================
    // 服务器相关
    // ============================================

    /** 获取服务器 */
    async getGuild(guildId: string) {
        return this.request(`/guilds/${guildId}`);
    }

    /** 获取服务器列表 */
    async getGuilds() {
        return this.request('/users/@me/guilds');
    }

    /** 获取服务器成员 */
    async getGuildMember(guildId: string, userId: string) {
        return this.request(`/guilds/${guildId}/members/${userId}`);
    }

    /** 获取服务器成员列表 */
    async getGuildMembers(guildId: string, options?: { limit?: number; after?: string }) {
        return this.request(`/guilds/${guildId}/members`, {
            query: options as Record<string, string>,
        });
    }

    /** 踢出成员 */
    async removeGuildMember(guildId: string, userId: string) {
        return this.request(`/guilds/${guildId}/members/${userId}`, {
            method: 'DELETE',
        });
    }

    /** 封禁成员 */
    async banGuildMember(guildId: string, userId: string, options?: { delete_message_seconds?: number }) {
        return this.request(`/guilds/${guildId}/bans/${userId}`, {
            method: 'PUT',
            body: options,
        });
    }

    // ============================================
    // Interactions 相关
    // ============================================

    /** 回复 Interaction */
    async createInteractionResponse(interactionId: string, interactionToken: string, response: any) {
        return this.request(`/interactions/${interactionId}/${interactionToken}/callback`, {
            method: 'POST',
            body: response,
        });
    }

    /** 获取原始 Interaction 回复 */
    async getOriginalInteractionResponse(applicationId: string, interactionToken: string) {
        return this.request(`/webhooks/${applicationId}/${interactionToken}/messages/@original`);
    }

    /** 编辑原始 Interaction 回复 */
    async editOriginalInteractionResponse(applicationId: string, interactionToken: string, content: any) {
        return this.request(`/webhooks/${applicationId}/${interactionToken}/messages/@original`, {
            method: 'PATCH',
            body: content,
        });
    }

    /** 创建后续消息 */
    async createFollowupMessage(applicationId: string, interactionToken: string, content: any) {
        return this.request(`/webhooks/${applicationId}/${interactionToken}`, {
            method: 'POST',
            body: content,
        });
    }

    // ============================================
    // Gateway 相关
    // ============================================

    /** 获取 Gateway URL */
    async getGateway() {
        return this.request('/gateway');
    }

    /** 获取 Gateway Bot URL（带分片信息） */
    async getGatewayBot() {
        return this.request('/gateway/bot');
    }
}
