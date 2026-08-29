/**
 * Mock 适配器实现
 * 用于测试和开发环境，不需要真实的外部服务
 */

import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    CommonTypes,
    defineAdapterCapabilities,
    unixSecondsToEventMs,
    type AdapterCapabilityManifest,
    type CommonEvent,
} from "onebots";
import { MockBot } from "./bot.js";
import type { MockConfig, MockUser, MockGroup } from "./types.js";

export const mockCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "group"] },
        delete_message: { support: "native", scenes: ["private", "group"] },
        get_message: { support: "native", scenes: ["private", "group"] },
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        get_friend_list: { support: "native" },
        get_friend_info: { support: "native" },
        get_group_list: { support: "native" },
        get_group_info: { support: "native" },
        get_group_member_list: { support: "native" },
        get_group_member_info: { support: "native" },
        get_status: { support: "native" },
        get_version: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "group"] },
        friend_request: { support: "native" },
        heartbeat: { support: "native" },
    },
    segments: {
        text: { support: "native", direction: "both" },
    },
    transports: {
        native: { support: "native", mode: "native" },
    },
});

interface MockIncomingMessage {
    type: "private" | "group";
    message_id: string;
    user_id: string;
    nickname?: string;
    group_id?: string;
    group_name?: string;
    content: string;
    time: number;
}

interface MockFriendRequest {
    type: "friend";
    user_id: string;
    nickname?: string;
    comment?: string;
    flag: string;
}

export class MockAdapter extends Adapter<MockBot, "mock"> {
    constructor(app: BaseApp) {
        super(app, "mock", mockCapabilities);
        this.icon = "https://via.placeholder.com/100?text=Mock";
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        const content = this.buildMessageContent(message);
        if (scene_type !== "private" && scene_type !== "group") {
            throw new TypeError(`Mock 仅支持 private/group 场景，收到 ${scene_type}`);
        }
        const type = scene_type;
        const result = await bot.sendMessage(sceneId.string, content, type);

        return {
            message_id: this.createId(result.message_id),
        };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const deleted = await bot.deleteMessage(
            this.coerceId(params.message_id as CommonTypes.Id | string | number).string,
        );
        if (!deleted) throw new Error(`消息 ${params.message_id.string} 不存在`);
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const message = await account.client.getMessage(params.message_id.string);
        if (!message) throw new Error(`消息 ${params.message_id.string} 不存在`);
        const isGroup = Boolean(message.group_id);
        return {
            message_id: this.createId(message.message_id),
            time: message.time,
            sender: {
                scene_type: isGroup ? "group" : "private",
                sender_id: this.createId(message.user_id),
                scene_id: this.createId(message.group_id ?? message.user_id),
                sender_name: "",
                scene_name: "",
            },
            message: [{ type: "text", data: { text: message.content } }],
        };
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

    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const info = await this.requireBot(uin).getUserInfo(params.user_id.string);
        if (!info) throw new Error(`Friend ${params.user_id.string} not found`);
        return {
            user_id: this.createId(info.user_id),
            user_name: info.nickname,
            remark: info.remark,
        };
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

    async getGroupInfo(
        uin: string,
        params: { group_id: CommonTypes.Id },
    ): Promise<Adapter.GroupInfo> {
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

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const members = await this.requireBot(uin).getGroupMemberList(params.group_id.string);
        return members.map(member => this.projectMember(params.group_id, member));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const member = await this.requireBot(uin).getGroupMemberInfo(
            params.group_id.string,
            params.user_id.string,
        );
        if (!member) throw new Error(`Member ${params.user_id.string} not found`);
        return this.projectMember(params.group_id, member);
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots Mock Adapter",
            impl: "mock",
        };
    }

    createAccount(config: Account.Config<"mock">): Account<"mock", MockBot> {
        const mockConfig: MockConfig = {
            account_id: config.account_id,
            nickname: config.nickname,
            avatar: config.avatar,
            auto_events: config.auto_events ?? false,
            event_interval: config.event_interval ?? 5000,
            latency: config.latency ?? 10,
            friends: config.friends,
            groups: config.groups,
        };

        const bot = new MockBot(mockConfig);
        const account = new Account<"mock", MockBot>(this, bot, config);

        // 监听事件
        bot.on("ready", (user: { user_id: string; nickname: string; avatar?: string }) => {
            this.logger.info(`Mock Bot ${user.nickname} (${user.user_id}) 已就绪`);
            account.status = AccountStatus.Online;
            account.nickname = user.nickname;
            account.avatar = user.avatar ?? "";
        });

        bot.on("stopped", () => {
            account.status = AccountStatus.OffLine;
        });

        bot.on("message", (event: MockIncomingMessage) => {
            const commonEvent: CommonEvent.Message<MockIncomingMessage> = {
                id: this.createId(event.message_id),
                timestamp: unixSecondsToEventMs(event.time),
                platform: "mock",
                bot_id: this.createId(config.account_id),
                type: "message",
                message_type: event.type,
                sender: {
                    id: this.createId(event.user_id),
                    name: event.nickname,
                },
                group: event.group_id
                    ? {
                          id: this.createId(event.group_id),
                          name: event.group_name,
                      }
                    : undefined,
                message_id: this.createId(event.message_id),
                raw_message: event.content,
                message: [{ type: "text", data: { text: event.content } }],
                raw_event: event,
            };
            account.dispatch(commonEvent);
        });

        bot.on("request", (event: MockFriendRequest) => {
            const commonEvent: CommonEvent.Request<MockFriendRequest> = {
                id: this.createId(event.flag),
                timestamp: Date.now(),
                platform: "mock",
                bot_id: this.createId(config.account_id),
                type: "request",
                request_type: "friend",
                user: {
                    id: this.createId(event.user_id),
                    name: event.nickname,
                },
                comment: event.comment,
                flag: event.flag,
                raw_event: event,
            };
            account.dispatch(commonEvent);
        });

        bot.on("heartbeat", (event: { time: number }) => {
            const commonEvent: CommonEvent.Meta<typeof event> = {
                id: this.createId(`heartbeat:${event.time}`),
                timestamp: event.time,
                platform: "mock",
                bot_id: this.createId(config.account_id),
                type: "meta",
                meta_type: "heartbeat",
                raw_event: event,
            };
            account.dispatch(commonEvent);
        });

        account.on("start", async () => {
            try {
                await bot.start();
            } catch (error) {
                this.logger.error(`启动 Mock Bot 失败:`, error);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on("stop", async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });

        return account;
    }

    private buildMessageContent(message: CommonTypes.Segment[]): string {
        return message
            .map(segment => {
                if (segment.type !== "text") {
                    throw new TypeError(`Mock 不支持消息段 ${segment.type}`);
                }
                return segment.data.text;
            })
            .join("");
    }

    private requireBot(uin: string): MockBot {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client;
    }

    private projectMember(
        groupId: CommonTypes.Id,
        member: import("./types.js").MockMember,
    ): Adapter.GroupMemberInfo {
        return {
            group_id: groupId,
            user_id: this.createId(member.user_id),
            user_name: member.nickname,
            card: member.card ?? "",
            role: member.role,
        };
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
AdapterRegistry.register("mock", MockAdapter, {
    name: "mock",
    displayName: "Mock 测试适配器",
    description: "用于测试和开发的模拟适配器，不需要真实的外部服务",
    icon: "https://via.placeholder.com/100?text=Mock",
    homepage: "https://github.com/lc-cn/onebots",
    author: "凉菜",
    capabilities: mockCapabilities,
});
