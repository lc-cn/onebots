/**
 * 黑盒语音 (Heychat) 适配器
 */
import {
    Account,
    Adapter,
    AdapterRegistry,
    AccountStatus,
    BaseApp,
    CommonEvent,
    CommonTypes,
} from 'onebots';
import { HeychatBot } from './bot.js';
import { extractRoomId } from './utils.js';
import type { HeychatConfig, HeychatMessageEvent } from './types.js';

export class HeychatAdapter extends Adapter<HeychatBot, 'heychat'> {
    constructor(app: BaseApp) {
        super(app, 'heychat');
        this.icon = 'https://chat.xiaoheihe.cn/favicon.ico';
    }

    /** 将框架层 ID 还原为黑盒平台原始字符串 ID */
    private toPlatformId(value: CommonTypes.Id | string | number): string {
        const resolved = this.resolveId(value);
        return String(resolved.source ?? resolved.string);
    }

    private buildMessageContent(message: CommonTypes.Segment[]): string {
        let content = '';
        for (const seg of message) {
            if (typeof seg === 'string') {
                content += seg;
            } else if (seg.type === 'text') {
                content += seg.data.text || '';
            } else if (seg.type === 'at') {
                const id = seg.data.qq || seg.data.id || '';
                content += `@${id} `;
            } else if (seg.type === 'image' && seg.data.url) {
                content += `[图片](${seg.data.url})`;
            } else if (seg.data?.text) {
                content += seg.data.text;
            }
        }
        return content;
    }

    private dispatchMessage(
        account: Account<'heychat', HeychatBot>,
        config: Account.Config<'heychat'>,
        event: HeychatMessageEvent,
    ): void {
        const contentPreview =
            event.raw_message.length > 100
                ? `${event.raw_message.slice(0, 100)}...`
                : event.raw_message;
        this.logger.info(
            `[Heychat] 收到${event.source === 'command' ? '命令' : '消息'} | ` +
                `消息ID: ${event.msg_id} | 房间: ${event.room_id} | 频道: ${event.channel_id} | ` +
                `发送者: ${event.nickname} | 内容: ${contentPreview}`,
        );

        const sceneKey = `${event.room_id}:${event.channel_id}`;
        const commonEvent: CommonEvent.Message = {
            id: this.createId(event.msg_id),
            timestamp: event.send_time,
            platform: 'heychat',
            bot_id: this.createId(config.account_id),
            type: 'message',
            message_type: 'group',
            sender: {
                id: this.createId(String(event.user_id)),
                name: event.nickname,
                avatar: event.avatar,
            },
            group: {
                id: this.createId(sceneKey),
                name: event.room_name || event.room_id,
            },
            message_id: this.createId(event.msg_id),
            raw_message: event.raw_message,
            message: [{ type: 'text', data: { text: event.raw_message } }],
        };

        account.dispatch(commonEvent);
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到账号 ${uin}`);

        const bot = account.client;
        const platformSceneId = this.toPlatformId(
            params.scene_id as CommonTypes.Id | string | number,
        );
        const { room_id, channel_id } = bot.resolveSendTarget(params.scene_type, platformSceneId);
        const content = this.buildMessageContent(params.message);
        if (!content) {
            throw new Error('消息段为空');
        }

        const result = await bot.sendChannelMessage(room_id, channel_id, content);
        return {
            message_id: this.createId(result.msg_id),
        };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到账号 ${uin}`);

        const bot = account.client;
        const msgId = this.toPlatformId(params.message_id as CommonTypes.Id | string | number);
        const context = bot.getMessageContext(msgId);

        let roomId = context?.room_id;
        let channelId = context?.channel_id;

        if (params.scene_id) {
            const platformSceneId = this.toPlatformId(
                params.scene_id as CommonTypes.Id | string | number,
            );
            const target = bot.resolveSendTarget(params.scene_type || 'channel', platformSceneId);
            roomId = target.room_id;
            channelId = target.channel_id;
        }

        if (!roomId || !channelId) {
            throw new Error('[Heychat] 删除消息需要 room_id 与 channel_id，请先收到该频道消息或提供 scene_id');
        }

        await bot.deleteChannelMessage(roomId, channelId, msgId);
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到账号 ${uin}`);

        const botId = account.client.getBotId();
        return {
            user_id: this.createId(botId !== null ? String(botId) : account.config.account_id),
            user_name: account.nickname || account.config.account_id,
            avatar: account.avatar || this.icon,
        };
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到账号 ${uin}`);

        const groupKey = this.toPlatformId(params.group_id);
        const roomId = extractRoomId(groupKey);
        const info = await account.client.getRoomInfo(roomId);
        return {
            group_id: this.createId(groupKey.includes(':') ? groupKey : info.room_id),
            group_name: info.room_name || info.room_id,
            member_count: info.member_count,
        };
    }

    createAccount(config: Account.Config<'heychat'>): Account<'heychat', HeychatBot> {
        const heychatConfig: HeychatConfig = {
            account_id: config.account_id,
            token: config.token,
            api_base: config.api_base,
            upload_base: config.upload_base,
            ws_url: config.ws_url,
            chat_version: config.chat_version,
            ping_interval: config.ping_interval,
            ignore_self_messages: config.ignore_self_messages ?? true,
            proxy: config.proxy,
        };

        const bot = new HeychatBot(heychatConfig);
        const account = new Account<'heychat', HeychatBot>(this, bot, config);

        bot.on('ready', () => {
            this.logger.info(`Heychat Bot ${config.account_id} 已就绪`);
            account.status = AccountStatus.Online;
        });

        bot.on('error', (error) => {
            this.logger.error(`Heychat Bot ${config.account_id} 错误:`, error);
        });

        bot.on('stopped', () => {
            account.status = AccountStatus.OffLine;
        });

        bot.on('message', (event: HeychatMessageEvent) => {
            this.dispatchMessage(account, config, event);
        });

        account.on('start', async () => {
            try {
                await bot.start();
            } catch (error) {
                this.logger.error(`Heychat Bot ${config.account_id} 启动失败:`, error);
                account.status = AccountStatus.OffLine;
                throw error;
            }
        });

        account.on('stop', async () => {
            await bot.stop();
        });

        return account;
    }
}

declare module 'onebots' {
    export namespace Adapter {
        export interface Configs {
            heychat: HeychatConfig;
        }
    }
}

AdapterRegistry.register('heychat', HeychatAdapter, {
    name: 'heychat',
    displayName: '黑盒语音',
    description: '黑盒语音官方机器人适配器，支持斜杠命令与频道消息',
    icon: 'https://chat.xiaoheihe.cn/favicon.ico',
    homepage: 'https://bot.xiaoheihe.cn',
    author: '凉菜',
});
