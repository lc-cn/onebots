/**
 * Slack Bot 客户端
 * 基于 @slack/web-api
 */
import { EventEmitter } from 'events';
import { WebClient } from '@slack/web-api';
import type { RouterContext, Next } from 'onebots';
import type {
    SlackConfig,
    SlackUser,
    SlackChannel,
    SlackMessage,
    SlackEvent,
    SlackWebhookBody,
    SlackBlock,
    SlackMessageOptions,
    SlackChatResult
} from './types.js';

export class SlackBot extends EventEmitter {
    private config: SlackConfig;
    private client: WebClient;
    private me: SlackUser | null = null;

    constructor(config: SlackConfig) {
        super();
        this.config = config;
        
        // 创建 Slack WebClient 实例
        this.client = new WebClient(config.token);
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        try {
            // 获取 Bot 信息
            const authTest = await this.client.auth.test();
            
            this.me = {
                id: authTest.user_id || '',
                name: authTest.user || '',
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
     * 处理 Webhook 请求（Events API）
     */
    async handleWebhook(ctx: RouterContext, next: Next): Promise<void> {
        const body = ctx.request.body as SlackWebhookBody;
        
        // 处理 URL 验证（Slack 首次配置 webhook 时会发送验证请求）
        if (body.type === 'url_verification') {
            ctx.body = { challenge: body.challenge };
            return;
        }

        // 处理事件
        if (body.event) {
            const event: SlackEvent = body.event;
            this.emit('event', event);
        }

        ctx.body = { ok: true };
        await next();
    }

    /**
     * 获取缓存的 Bot 信息
     */
    getCachedMe(): SlackUser | null {
        return this.me;
    }

    /**
     * 获取 Bot 信息
     */
    async getBotInfo(): Promise<SlackUser> {
        const authTest = await this.client.auth.test();
        
        return {
            id: authTest.user_id || '',
            name: authTest.user || '',
        };
    }

    /**
     * 发送消息
     */
    async sendMessage(channel: string, text: string, options?: SlackMessageOptions): Promise<SlackChatResult> {
        const result = await this.client.chat.postMessage({
            channel,
            text,
            ...options,
        });

        if (!result.ok) {
            throw new Error(`发送消息失败: ${result.error}`);
        }

        return result;
    }

    /**
     * 发送带 Blocks 的消息
     */
    async sendBlocks(channel: string, blocks: SlackBlock[], text?: string): Promise<SlackChatResult> {
        const result = await this.client.chat.postMessage({
            channel,
            blocks,
            text: text || ' ',
        });

        if (!result.ok) {
            throw new Error(`发送消息失败: ${result.error}`);
        }

        return result;
    }

    /**
     * 更新消息
     */
    async updateMessage(channel: string, ts: string, text: string, options?: SlackMessageOptions): Promise<SlackChatResult> {
        const result = await this.client.chat.update({
            channel,
            ts,
            text,
            ...options,
        });

        if (!result.ok) {
            throw new Error(`更新消息失败: ${result.error}`);
        }

        return result;
    }

    /**
     * 删除消息
     */
    async deleteMessage(channel: string, ts: string): Promise<boolean> {
        const result = await this.client.chat.delete({
            channel,
            ts,
        });

        if (!result.ok) {
            throw new Error(`删除消息失败: ${result.error}`);
        }

        return result.ok;
    }

    /**
     * 获取频道信息
     */
    async getChannelInfo(channelId: string): Promise<SlackChannel> {
        const result = await this.client.conversations.info({
            channel: channelId,
        });

        if (!result.ok || !result.channel) {
            throw new Error(`获取频道信息失败: ${result.error}`);
        }

        return result.channel as SlackChannel;
    }

    /**
     * 获取频道列表
     */
    async getChannelList(types?: string, excludeArchived?: boolean): Promise<SlackChannel[]> {
        const channels: SlackChannel[] = [];
        let cursor: string | undefined;

        do {
            const result = await this.client.conversations.list({
                types: types || 'public_channel,private_channel',
                exclude_archived: excludeArchived,
                cursor,
                limit: 200,
            });

            if (!result.ok) {
                throw new Error(`获取频道列表失败: ${result.error}`);
            }

            if (result.channels) {
                channels.push(...(result.channels as SlackChannel[]));
            }

            cursor = result.response_metadata?.next_cursor;
        } while (cursor);

        return channels;
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(userId: string): Promise<SlackUser> {
        const result = await this.client.users.info({
            user: userId,
        });

        if (!result.ok || !result.user) {
            throw new Error(`获取用户信息失败: ${result.error}`);
        }

        return result.user as SlackUser;
    }

    /**
     * 获取频道成员列表
     */
    async getChannelMembers(channelId: string): Promise<string[]> {
        const members: string[] = [];
        let cursor: string | undefined;

        do {
            const result = await this.client.conversations.members({
                channel: channelId,
                cursor,
                limit: 200,
            });

            if (!result.ok) {
                throw new Error(`获取频道成员列表失败: ${result.error}`);
            }

            if (result.members) {
                members.push(...result.members);
            }

            cursor = result.response_metadata?.next_cursor;
        } while (cursor);

        return members;
    }

    /**
     * 离开频道
     */
    async leaveChannel(channelId: string): Promise<boolean> {
        const result = await this.client.conversations.leave({
            channel: channelId,
        });

        if (!result.ok) {
            throw new Error(`离开频道失败: ${result.error}`);
        }

        return result.ok;
    }

    /**
     * 踢出频道成员
     */
    async kickChannelMember(channelId: string, userId: string): Promise<boolean> {
        // Slack 不直接支持踢出成员，需要通过其他方式
        throw new Error('Slack 不支持直接踢出频道成员');
    }

    /**
     * 获取 WebClient 实例（用于高级用法）
     */
    getWebClient(): WebClient {
        return this.client;
    }
}

