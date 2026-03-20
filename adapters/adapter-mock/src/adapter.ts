/**
 * Mock 适配器实现
 * 用于测试和开发环境，不需要真实的外部服务
 */

import { Account, AdapterRegistry, AccountStatus, BaseApp, Adapter, CommonTypes } from "onebots";
import { MockBot } from "./bot.js";
import type { MockConfig, MockUser, MockGroup } from "./types.js";

export class MockAdapter extends Adapter<MockBot, "mock"> {
    constructor(app: BaseApp) {
        super(app, "mock");
        this.icon = "https://via.placeholder.com/100?text=Mock";
    }

    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        const content = this.buildMessageContent(message);
        const type = scene_type === "private" ? "private" : "group";
        const result = await bot.sendMessage(sceneId.string, content, type);

        return {
            message_id: this.createId(result.message_id),
        };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.deleteMessage(this.coerceId(params.message_id as CommonTypes.Id | string | number).string);
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const info = await bot.getLoginInfo();

        return {
            user_id: this.createId(info.user_id),
            user_name: info.nickname,
        };
    }

    async getUserInfo(uin: string, params: { user_id: CommonTypes.Id }): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const info = await bot.getUserInfo(params.user_id.string);

        if (!info) {
            throw new Error(`User ${params.user_id.string} not found`);
        }

        return {
            user_id: this.createId(info.user_id),
            user_name: info.nickname,
            avatar: info.avatar,
        };
    }

    async getFriendList(uin: string): Promise<Adapter.UserInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const friends = await bot.getFriendList();

        return friends.map((f: MockUser) => ({
            user_id: this.createId(f.user_id),
            user_name: f.nickname,
            avatar: f.avatar,
        }));
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groups = await bot.getGroupList();

        return groups.map((g: MockGroup) => ({
            group_id: this.createId(g.group_id),
            group_name: g.group_name,
            member_count: g.member_count,
            max_member_count: g.max_member_count,
        }));
    }

    async getGroupInfo(uin: string, params: { group_id: CommonTypes.Id }): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const info = await bot.getGroupInfo(params.group_id.string);

        if (!info) {
            throw new Error(`Group ${params.group_id.string} not found`);
        }

        return {
            group_id: this.createId(info.group_id),
            group_name: info.group_name,
            member_count: info.member_count,
            max_member_count: info.max_member_count,
        };
    }

    createAccount(config: Account.Config<'mock'>): Account<'mock', MockBot> {
        const mockConfig: MockConfig = {
            account_id: config.account_id,
            nickname: (config as any).nickname,
            avatar: (config as any).avatar,
            auto_events: (config as any).auto_events ?? false,
            event_interval: (config as any).event_interval ?? 5000,
            latency: (config as any).latency ?? 10,
            friends: (config as any).friends,
            groups: (config as any).groups,
        };

        const bot = new MockBot(mockConfig);
        const account = new Account<'mock', MockBot>(this, bot, config);

        // 监听事件
        bot.on('ready', (user: { user_id: string; nickname: string; avatar?: string }) => {
            this.logger.info(`Mock Bot ${user.nickname} (${user.user_id}) 已就绪`);
            account.status = AccountStatus.Online;
            account.nickname = user.nickname;
            account.avatar = user.avatar;
        });

        bot.on('stopped', () => {
            account.status = AccountStatus.OffLine;
        });

        account.on('start', async () => {
            try {
                await bot.start();
            } catch (error) {
                this.logger.error(`启动 Mock Bot 失败:`, error);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on('stop', async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });

        return account;
    }

    private buildMessageContent(message: CommonTypes.Segment[]): string {
        return message
            .map(seg => {
                if (seg.type === 'text') {
                    return seg.data.text;
                }
                return `[${seg.type}]`;
            })
            .join('');
    }
}

// 扩展类型声明
declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            mock: MockConfig;
        }
    }
}

// 注册适配器
AdapterRegistry.register('mock', MockAdapter, {
    name: 'mock',
    displayName: 'Mock 测试适配器',
    description: '用于测试和开发的模拟适配器，不需要真实的外部服务',
    icon: 'https://via.placeholder.com/100?text=Mock',
    homepage: 'https://github.com/lc-cn/onebots',
    author: '凉菜',
});
