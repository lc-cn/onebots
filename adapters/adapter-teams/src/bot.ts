/**
 * Microsoft Teams Bot 客户端
 * 基于 Bot Framework SDK
 */
import { EventEmitter } from 'events';
import { BotFrameworkAdapter, type BotFrameworkAdapterSettings, type Attachment, Activity, TurnContext, MessageFactory, ConversationReference, ConversationAccount, ResourceResponse } from 'botbuilder';
import type { RouterContext, Next } from 'onebots';
import type { TeamsConfig, TeamsActivity, TeamsChannelData, TeamsEvent, SendMessageOptions } from './types.js';

/** Bot 缓存的自身信息 */
interface CachedBotInfo {
    id?: string;
    name?: string;
    avatar?: string;
}

export class TeamsBot extends EventEmitter {
    private config: TeamsConfig;
    private adapter: BotFrameworkAdapter;
    private me: CachedBotInfo | null = null;

    constructor(config: TeamsConfig) {
        super();
        this.config = config;

        // 创建 Bot Framework Adapter
        const adapterSettings: BotFrameworkAdapterSettings = {
            appId: config.app_id,
            appPassword: config.app_password,
        };

        if (config.channel_service) {
            adapterSettings.channelService = config.channel_service;
        }

        if (config.open_id_metadata) {
            adapterSettings.openIdMetadata = config.open_id_metadata;
        }

        this.adapter = new BotFrameworkAdapter(adapterSettings);

        // 设置错误处理
        this.adapter.onTurnError = async (context: TurnContext, error: Error) => {
            console.error(`Teams Bot Error: ${error.message}`, error);
            this.emit('error', error);
            
            // 发送错误消息给用户
            try {
                await context.sendActivity('抱歉，发生了错误。');
            } catch (e) {
                console.error('Failed to send error message:', e);
            }
        };
    }

    /**
     * 转换活动为内部格式
     */
    private transformActivity(activity: Activity): TeamsActivity {
        const channelData = activity.channelData as TeamsChannelData | undefined;
        return {
            type: activity.type || 'message',
            id: activity.id || '',
            timestamp: activity.timestamp?.toISOString() || new Date().toISOString(),
            from: {
                id: activity.from?.id || '',
                name: activity.from?.name || '',
                aadObjectId: activity.from?.aadObjectId,
                role: activity.from?.role,
                tenantId: channelData?.tenant?.id,
            },
            conversation: {
                id: activity.conversation?.id || '',
                name: activity.conversation?.name,
                isGroup: activity.conversation?.conversationType === 'channel',
            },
            channelId: activity.channelId || '',
            channelData: channelData,
            text: activity.text,
            attachments: activity.attachments?.map(att => ({
                contentType: att.contentType,
                contentUrl: att.contentUrl,
                content: att.content,
                name: att.name,
                thumbnailUrl: att.thumbnailUrl,
            })),
            value: activity.value as Record<string, unknown> | undefined,
        };
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        try {
            // Bot Framework 通过 Webhook 接收消息，不需要主动连接
            // 这里可以获取 Bot 信息（如果支持）
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
        try {
            // Bot Framework 不需要特殊停止逻辑
            this.emit('stopped');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * 处理 Webhook 请求
     */
    async handleWebhook(ctx: RouterContext, next: Next): Promise<void> {
        try {
            // Bot Framework Adapter 需要 Express 风格的 req/res
            // Koa 的 req/res 兼容 WebRequest/WebResponse 接口，此处使用 unknown 中转断言
            await this.adapter.processActivity(
                ctx.req as unknown as import('botbuilder').WebRequest,
                ctx.res as unknown as import('botbuilder').WebResponse,
                async (turnContext: TurnContext) => {
                    const activity = turnContext.activity;

                    // 转换活动
                    const teamsActivity = this.transformActivity(activity);

                    // 根据活动类型触发不同事件
                    if (activity.type === 'message') {
                        // 判断是私聊还是群聊
                        const isGroup = activity.conversation?.conversationType === 'channel';
                        if (isGroup) {
                            this.emit('group_message', {
                                type: 'message',
                                activity: teamsActivity,
                            });
                        } else {
                            this.emit('private_message', {
                                type: 'message',
                                activity: teamsActivity,
                            });
                        }
                    } else if (activity.type === 'messageUpdate') {
                        this.emit('message_edited', {
                            type: 'messageUpdate',
                            activity: teamsActivity,
                        });
                    } else if (activity.type === 'messageDelete') {
                        this.emit('message_deleted', {
                            type: 'messageDelete',
                            activity: teamsActivity,
                        });
                    } else if (activity.type === 'conversationUpdate') {
                        // 处理成员加入/离开
                        if (activity.membersAdded && activity.membersAdded.length > 0) {
                            this.emit('member_joined', {
                                type: 'conversationUpdate',
                                activity: teamsActivity,
                            });
                        }
                        if (activity.membersRemoved && activity.membersRemoved.length > 0) {
                            this.emit('member_left', {
                                type: 'conversationUpdate',
                                activity: teamsActivity,
                            });
                        }
                    } else if (activity.type === 'typing') {
                        this.emit('typing', {
                            type: 'typing',
                            activity: teamsActivity,
                        });
                    } else {
                        // 其他类型的事件（activity.type 在 Bot Framework 中为 string，
                        // 但 TeamsEvent.type 限定了特定值，此处已知非标准类型）
                        this.emit('event', {
                            type: activity.type as TeamsEvent['type'],
                            activity: teamsActivity,
                        });
                    }
                }
            );
        } catch (error) {
            console.error('Teams Webhook 处理错误:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
    }

    /**
     * 获取缓存的 Bot 信息
     */
    getCachedMe(): CachedBotInfo | null {
        return this.me;
    }

    /**
     * 发送消息
     */
    async sendMessage(conversationId: string, text: string, options?: SendMessageOptions): Promise<ResourceResponse> {
        const conversation: ConversationAccount = {
            id: conversationId,
            conversationType: options?.isGroup ? 'channel' : 'personal',
            isGroup: options?.isGroup || false,
            name: options?.conversationName,
        };

        const reference: Partial<ConversationReference> = {
            activityId: options?.reply_to_message_id,
            channelId: 'msteams',
            conversation,
        };

        const activity = MessageFactory.text(text);
        if (options?.reply_to_message_id) {
            activity.replyToId = options.reply_to_message_id;
        }

        let result: ResourceResponse = { id: '' };
        await this.adapter.continueConversation(
            reference as ConversationReference,
            async (turnContext: TurnContext) => {
                result = await turnContext.sendActivity(activity) as ResourceResponse;
            }
        );
        return result;
    }

    /**
     * 发送自适应卡片
     */
    async sendCard(conversationId: string, card: Attachment, options?: SendMessageOptions): Promise<ResourceResponse> {
        const conversation: ConversationAccount = {
            id: conversationId,
            conversationType: options?.isGroup ? 'channel' : 'personal',
            isGroup: options?.isGroup || false,
            name: options?.conversationName,
        };

        const reference: Partial<ConversationReference> = {
            channelId: 'msteams',
            conversation,
        };

        const activity = MessageFactory.attachment(card);

        let result: ResourceResponse = { id: '' };
        await this.adapter.continueConversation(
            reference as ConversationReference,
            async (turnContext: TurnContext) => {
                result = await turnContext.sendActivity(activity) as ResourceResponse;
            }
        );
        return result;
    }

    /**
     * 更新消息
     */
    async updateMessage(conversationId: string, activityId: string, text: string, options?: SendMessageOptions): Promise<void> {
        const conversation: ConversationAccount = {
            id: conversationId,
            conversationType: options?.isGroup ? 'channel' : 'personal',
            isGroup: options?.isGroup || false,
            name: options?.conversationName,
        };

        const reference: Partial<ConversationReference> = {
            activityId,
            channelId: 'msteams',
            conversation,
        };

        const activity = MessageFactory.text(text);
        activity.id = activityId;

        await this.adapter.continueConversation(
            reference as ConversationReference,
            async (turnContext: TurnContext) => {
                await turnContext.updateActivity(activity);
            }
        );
    }

    /**
     * 删除消息
     */
    async deleteMessage(conversationId: string, activityId: string, options?: SendMessageOptions): Promise<void> {
        const conversation: ConversationAccount = {
            id: conversationId,
            conversationType: options?.isGroup ? 'channel' : 'personal',
            isGroup: options?.isGroup || false,
            name: options?.conversationName,
        };

        const reference: Partial<ConversationReference> = {
            activityId,
            channelId: 'msteams',
            conversation,
        };

        await this.adapter.continueConversation(
            reference as ConversationReference,
            async (turnContext: TurnContext) => {
                await turnContext.deleteActivity(activityId);
            }
        );
    }

    /**
     * 获取 Adapter 实例（用于高级用法）
     */
    getAdapter(): BotFrameworkAdapter {
        return this.adapter;
    }
}

