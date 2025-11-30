/**
 * 微信公众号 Bot 客户端
 * 使用 Fetch API，完全 ESM 模块
 */
import { EventEmitter } from 'events';
import { Context, Next } from 'koa';
import type {
    WechatConfig,
    WechatUser,
    WechatUserList,
    WechatTag,
    WechatAccessToken,
    WechatApiResponse,
    WechatNewsMessage,
    WechatTemplateMessage,
    WechatIncomingMessage,
} from './types.js';
import { buildPassiveReply, verifySignature, decryptMessage, parseXML } from './utils.js';

export class WechatBot extends EventEmitter {
    private accessToken: string = '';
    private tokenExpireTime: number = 0;
    private baseURL: string = 'https://api.weixin.qq.com';
    private config: WechatConfig;
    private isServiceAccount: boolean;
    // 被动回复队列 (openid -> 回复内容)
    private passiveReplyQueue: Map<string, any> = new Map();
    // 消息上下文 (openid -> { timestamp, fromUser, toUser })
    private messageContext: Map<string, { timestamp: number; fromUser: string; toUser: string }> = new Map();

    constructor(config: WechatConfig) {
        super();
        this.config = config;
        this.isServiceAccount = config.accountType === 'service';
    }

    /**
     * 获取 Access Token
     */
    async getAccessToken(): Promise<string> {
        // 订阅号不需要 access_token
        if (!this.isServiceAccount) {
            throw new Error('订阅号不支持需要 access_token 的 API 调用，仅支持被动回复');
        }

        const now = Date.now();
        
        // 如果 token 还有效（提前 5 分钟刷新）
        if (this.accessToken && this.tokenExpireTime - now > 5 * 60 * 1000) {
            return this.accessToken;
        }

        try {
            const url = new URL('/cgi-bin/token', this.baseURL);
            url.searchParams.set('grant_type', 'client_credential');
            url.searchParams.set('appid', this.config.appId);
            url.searchParams.set('secret', this.config.appSecret);

            const response = await fetch(url.toString());
            const data = await response.json() as WechatAccessToken;

            if (!response.ok || !data.access_token) {
                throw new Error(`获取 Access Token 失败: ${JSON.stringify(data)}`);
            }

            this.accessToken = data.access_token;
            this.tokenExpireTime = now + data.expires_in * 1000;
            
            this.emit('token_refreshed', this.accessToken);
            return this.accessToken;
        } catch (error: any) {
            this.emit('error', new Error(`获取 Access Token 失败: ${error.message}`));
            throw error;
        }
    }

    /**
     * 调用微信 API
     */
    private async callApi<T = any>(
        method: 'GET' | 'POST',
        path: string,
        body?: any,
        params?: Record<string, string>
    ): Promise<T> {
        const token = await this.getAccessToken();
        const url = new URL(path, this.baseURL);
        url.searchParams.set('access_token', token);
        
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                url.searchParams.set(key, value);
            });
        }

        try {
            const options: RequestInit = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
            };

            if (body && method === 'POST') {
                options.body = JSON.stringify(body);
            }

            const response = await fetch(url.toString(), options);
            const data = await response.json() as WechatApiResponse<T>;

            if (data.errcode && data.errcode !== 0) {
                throw new Error(`微信 API 错误 [${data.errcode}]: ${data.errmsg}`);
            }

            return data as T;
        } catch (error: any) {
            this.emit('error', error);
            throw error;
        }
    }

    // ============================================
    // 消息发送
    // ============================================

    /**
     * 发送文本消息
     * 优先使用被动回复（5秒内），否则使用客服消息（需要服务号）
     */
    async sendText(openid: string, content: string, forceActive: boolean = false): Promise<string> {
        const context = this.messageContext.get(openid);
        const now = Date.now();
        
        // 如果5秒内收到过消息且未强制主动发送，使用被动回复
        if (!forceActive && context && now - context.timestamp < 5000) {
            const replyXml = buildPassiveReply(context.toUser, context.fromUser, {
                type: 'text',
                content,
            });
            this.passiveReplyQueue.set(openid, replyXml);
            return `passive_${Date.now()}`;
        }
        
        // 使用客服消息（仅服务号支持）
        const data = {
            touser: openid,
            msgtype: 'text',
            text: { content },
        };
        
        const result = await this.callApi<{ msgid: number }>('POST', '/cgi-bin/message/custom/send', data);
        return result.msgid?.toString() || `${Date.now()}`;
    }

    /**
     * 等待被动回复
     */
    private async waitForPassiveReply(openid: string, timeout: number): Promise<string | null> {
        const startTime = Date.now();
        
        // 轮询检查回复队列
        while (Date.now() - startTime < timeout) {
            const reply = this.passiveReplyQueue.get(openid);
            if (reply) {
                this.passiveReplyQueue.delete(openid);
                return reply;
            }
            // 等待 50ms 后再检查
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        return null;
    }

    /**
     * 发送图片消息
     */
    async sendImage(openid: string, mediaId: string, forceActive: boolean = false): Promise<string> {
        const context = this.messageContext.get(openid);
        const now = Date.now();
        
        // 被动回复
        if (!forceActive && context && now - context.timestamp < 5000) {
            const replyXml = buildPassiveReply(context.toUser, context.fromUser, {
                type: 'image',
                mediaId,
            });
            this.passiveReplyQueue.set(openid, replyXml);
            return `passive_${Date.now()}`;
        }
        
        // 客服消息
        const data = {
            touser: openid,
            msgtype: 'image',
            image: { media_id: mediaId },
        };
        
        const result = await this.callApi<{ msgid: number }>('POST', '/cgi-bin/message/custom/send', data);
        return result.msgid?.toString() || `${Date.now()}`;
    }

    /**
     * 发送语音消息
     */
    async sendVoice(openid: string, mediaId: string, forceActive: boolean = false): Promise<string> {
        const context = this.messageContext.get(openid);
        const now = Date.now();
        
        // 被动回复
        if (!forceActive && context && now - context.timestamp < 5000) {
            const replyXml = buildPassiveReply(context.toUser, context.fromUser, {
                type: 'voice',
                mediaId,
            });
            this.passiveReplyQueue.set(openid, replyXml);
            return `passive_${Date.now()}`;
        }
        
        // 客服消息
        const data = {
            touser: openid,
            msgtype: 'voice',
            voice: { media_id: mediaId },
        };
        
        const result = await this.callApi<{ msgid: number }>('POST', '/cgi-bin/message/custom/send', data);
        return result.msgid?.toString() || `${Date.now()}`;
    }

    /**
     * 发送视频消息
     */
    async sendVideo(
        openid: string,
        mediaId: string,
        title?: string,
        description?: string,
        forceActive: boolean = false
    ): Promise<string> {
        const context = this.messageContext.get(openid);
        const now = Date.now();
        
        // 被动回复
        if (!forceActive && context && now - context.timestamp < 5000) {
            const replyXml = buildPassiveReply(context.toUser, context.fromUser, {
                type: 'video',
                mediaId,
                title,
                description,
            });
            this.passiveReplyQueue.set(openid, replyXml);
            return `passive_${Date.now()}`;
        }
        
        // 客服消息
        const data = {
            touser: openid,
            msgtype: 'video',
            video: {
                media_id: mediaId,
                title,
                description,
            },
        };
        
        const result = await this.callApi<{ msgid: number }>('POST', '/cgi-bin/message/custom/send', data);
        return result.msgid?.toString() || `${Date.now()}`;
    }

    /**
     * 发送音乐消息
     */
    async sendMusic(
        openid: string,
        title: string,
        description: string,
        musicUrl: string,
        hqMusicUrl: string,
        thumbMediaId: string,
        forceActive: boolean = false
    ): Promise<string> {
        const context = this.messageContext.get(openid);
        const now = Date.now();
        
        // 被动回复
        if (!forceActive && context && now - context.timestamp < 5000) {
            const replyXml = buildPassiveReply(context.toUser, context.fromUser, {
                type: 'music',
                title,
                description,
                musicUrl,
                hqMusicUrl,
                thumbMediaId,
            });
            this.passiveReplyQueue.set(openid, replyXml);
            return `passive_${Date.now()}`;
        }
        
        // 客服消息
        const data = {
            touser: openid,
            msgtype: 'music',
            music: {
                title,
                description,
                musicurl: musicUrl,
                hqmusicurl: hqMusicUrl,
                thumb_media_id: thumbMediaId,
            },
        };
        
        const result = await this.callApi<{ msgid: number }>('POST', '/cgi-bin/message/custom/send', data);
        return result.msgid?.toString() || `${Date.now()}`;
    }

    /**
     * 发送图文消息
     */
    async sendNews(
        openid: string,
        articles: Array<{
            title: string;
            description?: string;
            picUrl?: string;
            url?: string;
        }>,
        forceActive: boolean = false
    ): Promise<string> {
        const context = this.messageContext.get(openid);
        const now = Date.now();
        
        // 被动回复
        if (!forceActive && context && now - context.timestamp < 5000) {
            const replyXml = buildPassiveReply(context.toUser, context.fromUser, {
                type: 'news',
                articles,
            });
            this.passiveReplyQueue.set(openid, replyXml);
            return `passive_${Date.now()}`;
        }
        
        // 客服消息
        const data = {
            touser: openid,
            msgtype: 'news',
            news: { articles },
        };
        
        const result = await this.callApi<{ msgid: number }>('POST', '/cgi-bin/message/custom/send', data);
        return result.msgid?.toString() || `${Date.now()}`;
    }

    /**
     * 发送模板消息
     */
    async sendTemplate(message: WechatTemplateMessage): Promise<string> {
        const result = await this.callApi<{ msgid: number }>('POST', '/cgi-bin/message/template/send', message);
        return result.msgid?.toString() || `${Date.now()}`;
    }

    // ============================================
    // 用户管理
    // ============================================

    /**
     * 获取用户信息
     */
    async getUserInfo(openid: string, lang: string = 'zh_CN'): Promise<WechatUser> {
        return this.callApi<WechatUser>('GET', '/cgi-bin/user/info', undefined, { openid, lang });
    }

    /**
     * 获取用户列表
     */
    async getUserList(nextOpenid?: string): Promise<WechatUserList> {
        const params = nextOpenid ? { next_openid: nextOpenid } : undefined;
        return this.callApi<WechatUserList>('GET', '/cgi-bin/user/get', undefined, params);
    }

    /**
     * 批量获取用户信息
     */
    async batchGetUserInfo(openids: string[]): Promise<WechatUser[]> {
        const data = {
            user_list: openids.map(openid => ({ openid, lang: 'zh_CN' })),
        };
        
        const result = await this.callApi<{ user_info_list: WechatUser[] }>(
            'POST',
            '/cgi-bin/user/info/batchget',
            data
        );
        
        return result.user_info_list || [];
    }

    /**
     * 设置用户备注名
     */
    async updateUserRemark(openid: string, remark: string): Promise<void> {
        await this.callApi('POST', '/cgi-bin/user/info/updateremark', {
            openid,
            remark,
        });
    }

    // ============================================
    // 用户标签管理
    // ============================================

    /**
     * 创建标签
     */
    async createTag(name: string): Promise<WechatTag> {
        const result = await this.callApi<{ tag: WechatTag }>(
            'POST',
            '/cgi-bin/tags/create',
            { tag: { name } }
        );
        return result.tag;
    }

    /**
     * 获取所有标签
     */
    async getTags(): Promise<WechatTag[]> {
        const result = await this.callApi<{ tags: WechatTag[] }>('GET', '/cgi-bin/tags/get');
        return result.tags || [];
    }

    /**
     * 更新标签
     */
    async updateTag(id: number, name: string): Promise<void> {
        await this.callApi('POST', '/cgi-bin/tags/update', {
            tag: { id, name },
        });
    }

    /**
     * 删除标签
     */
    async deleteTag(id: number): Promise<void> {
        await this.callApi('POST', '/cgi-bin/tags/delete', {
            tag: { id },
        });
    }

    /**
     * 获取标签下的粉丝列表
     */
    async getTagUsers(tagid: number, nextOpenid?: string): Promise<WechatUserList> {
        return this.callApi<WechatUserList>('POST', '/cgi-bin/user/tag/get', {
            tagid,
            next_openid: nextOpenid,
        });
    }

    /**
     * 批量为用户打标签
     */
    async batchTagUsers(openids: string[], tagid: number): Promise<void> {
        await this.callApi('POST', '/cgi-bin/tags/members/batchtagging', {
            openid_list: openids,
            tagid,
        });
    }

    /**
     * 批量为用户取消标签
     */
    async batchUntagUsers(openids: string[], tagid: number): Promise<void> {
        await this.callApi('POST', '/cgi-bin/tags/members/batchuntagging', {
            openid_list: openids,
            tagid,
        });
    }

    /**
     * 获取用户的标签列表
     */
    async getUserTags(openid: string): Promise<number[]> {
        const result = await this.callApi<{ tagid_list: number[] }>(
            'POST',
            '/cgi-bin/tags/getidlist',
            { openid }
        );
        return result.tagid_list || [];
    }

    // ============================================
    // 黑名单管理
    // ============================================

    /**
     * 获取黑名单列表
     */
    async getBlacklist(beginOpenid?: string): Promise<WechatUserList> {
        return this.callApi<WechatUserList>('POST', '/cgi-bin/tags/members/getblacklist', {
            begin_openid: beginOpenid,
        });
    }

    /**
     * 拉黑用户
     */
    async batchBlackUsers(openids: string[]): Promise<void> {
        await this.callApi('POST', '/cgi-bin/tags/members/batchblacklist', {
            openid_list: openids,
        });
    }

    /**
     * 取消拉黑用户
     */
    async batchUnblackUsers(openids: string[]): Promise<void> {
        await this.callApi('POST', '/cgi-bin/tags/members/batchunblacklist', {
            openid_list: openids,
        });
    }

    /**
     * 处理 Webhook 请求
     */
    async handleWebhook(ctx: Context, next: Next): Promise<void> {
        const { signature, timestamp, nonce, echostr, encrypt_type, msg_signature } = ctx.query;
        // GET 请求 - 验证服务器
        if (ctx.method === 'GET') {
            if (verifySignature(this.config.token, signature as string, timestamp as string, nonce as string)) {
                ctx.body = echostr;
            } else {
                ctx.status = 403;
                ctx.body = 'Invalid signature';
            }
            return;
        }

        // POST 请求 - 接收消息/事件
        if (ctx.method === 'POST') {
            let xmlBody = '';
            
            // 从原始请求流读取数据（绕过 bodyParser）
            const chunks: Buffer[] = [];
            for await (const chunk of ctx.req) {
                chunks.push(chunk as Buffer);
            }
            xmlBody = Buffer.concat(chunks).toString('utf-8');

            if (!xmlBody) {
                ctx.status = 400;
                ctx.body = 'Empty request body';
                return;
            }

            try {
                let messageXml = xmlBody;

                // 加密模式
                if (encrypt_type === 'aes') {
                    if (!msg_signature) {
                        throw new Error('加密模式需要 msg_signature');
                    }

                    // 解析加密消息
                    const encryptMatch = xmlBody.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
                    if (!encryptMatch) {
                        throw new Error('无法提取加密消息');
                    }

                    const encryptedMsg = encryptMatch[1];

                    // 验证签名
                    if (!verifySignature(this.config.token, msg_signature as string, timestamp as string, nonce as string, encryptedMsg)) {
                        ctx.status = 403;
                        ctx.body = 'Invalid msg_signature';
                        return;
                    }

                    // 解密消息
                    messageXml = decryptMessage(encryptedMsg, this.config.encodingAESKey!);
                } else {
                    // 明文模式 - 验证签名
                    if (!verifySignature(this.config.token, signature as string, timestamp as string, nonce as string)) {
                        ctx.status = 403;
                        ctx.body = 'Invalid signature';
                        return;
                    }
                }

                // 解析 XML
                const message = parseXML(messageXml) as WechatIncomingMessage;
                
                // 记录消息上下文（用于被动回复）
                if (message.FromUserName && message.ToUserName) {
                    this.messageContext.set(message.FromUserName, {
                        timestamp: Date.now(),
                        fromUser: message.FromUserName,
                        toUser: message.ToUserName,
                    });
                    
                    // 5秒后清理上下文
                    setTimeout(() => {
                        this.messageContext.delete(message.FromUserName);
                    }, 5000);
                }
                
                // 根据消息类型触发不同事件
                this.dispatchMessage(message);

                // 等待被动回复（最多等待4秒）
                const reply = await this.waitForPassiveReply(message.FromUserName, 4000);
                
                if (reply) {
                    ctx.type = 'application/xml';
                    ctx.body = reply;
                } else {
                    // 返回空字符串表示不回复
                    ctx.body = '';
                }
            } catch (error: any) {
                this.emit('error', error);
                ctx.status = 500;
                ctx.body = `Error: ${error.message}`;
            }
        }
    }

    /**
     * 派发消息/事件
     */
    private dispatchMessage(message: WechatIncomingMessage): void {
        const msgType = message.MsgType;

        // 消息事件
        if (msgType === 'text' || msgType === 'image' || msgType === 'voice' || 
            msgType === 'video' || msgType === 'music' || msgType === 'news') {
            this.emit('message', message);
        }
        // 事件推送
        else if (msgType === 'event') {
            const eventType = message.Event;
            
            switch (eventType) {
                case 'subscribe':
                    this.emit('event.subscribe', message);
                    break;
                case 'unsubscribe':
                    this.emit('event.unsubscribe', message);
                    break;
                case 'SCAN':
                    this.emit('event.scan', message);
                    break;
                case 'LOCATION':
                    this.emit('event.location', message);
                    break;
                case 'CLICK':
                    this.emit('event.click', message);
                    break;
                case 'VIEW':
                    this.emit('event.view', message);
                    break;
                default:
                    this.emit('event', message);
            }
        }
        // 其他类型
        else {
            this.emit('raw', message);
        }
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        try {
            // 只有服务号才获取 access_token
            if (this.isServiceAccount) {
                await this.getAccessToken();
            }
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
        this.accessToken = '';
        this.tokenExpireTime = 0;
        this.emit('stopped');
    }
}
