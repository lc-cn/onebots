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
    readPackageVersion,
} from "onebots";
import { MockBot } from "./bot.js";
import { mockCapabilities } from "./capabilities.js";
import { MockError } from "./errors.js";
import { projectMockHeartbeat, projectMockMessage, projectMockRequest } from "./events.js";
import { compileMockMessage } from "./messages.js";
import type { MockConfig, MockMember } from "./types.js";

export class MockAdapter extends Adapter<MockBot, "mock"> {
    constructor(app: BaseApp) {
        super(app, "mock", mockCapabilities);
        this.icon = "https://via.placeholder.com/100?text=Mock";
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const bot = this.requireBot(uin);
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id);

        const content = compileMockMessage(message);
        if (scene_type !== "private" && scene_type !== "group") {
            throw new MockError(`Mock 仅支持 private/group 场景，收到 ${scene_type}`, {
                code: "MOCK_UNSUPPORTED_SCENE",
            });
        }
        const type = scene_type;
        const result = await bot.sendMessage(sceneId.string, content, type);

        return {
            message_id: this.createId(result.message_id),
        };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const messageId = this.coerceId(params.message_id).string;
        const deleted = await this.requireBot(uin).deleteMessage(messageId);
        if (!deleted)
            throw new MockError(`Mock 消息 ${messageId} 不存在`, {
                code: "MOCK_MESSAGE_NOT_FOUND",
            });
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const messageId = this.coerceId(params.message_id).string;
        const message = await this.requireBot(uin).getMessage(messageId);
        if (!message)
            throw new MockError(`Mock 消息 ${messageId} 不存在`, {
                code: "MOCK_MESSAGE_NOT_FOUND",
            });
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
        const bot = this.requireBot(uin);
        const info = await bot.getLoginInfo();

        return {
            user_id: this.createId(info.user_id),
            user_name: info.nickname,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const bot = this.requireBot(uin);
        const info = await bot.getUserInfo(params.user_id.string);

        if (!info) {
            throw new MockError(`Mock 用户 ${params.user_id.string} 不存在`, {
                code: "MOCK_USER_NOT_FOUND",
            });
        }

        return {
            user_id: this.createId(info.user_id),
            user_name: info.nickname,
            avatar: info.avatar,
        };
    }

    async getFriendList(uin: string): Promise<Adapter.UserInfo[]> {
        const bot = this.requireBot(uin);
        const friends = await bot.getFriendList();

        return friends.map(friend => ({
            user_id: this.createId(friend.user_id),
            user_name: friend.nickname,
            avatar: friend.avatar,
        }));
    }

    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const info = await this.requireBot(uin).getUserInfo(params.user_id.string);
        if (!info)
            throw new MockError(`Mock 好友 ${params.user_id.string} 不存在`, {
                code: "MOCK_FRIEND_NOT_FOUND",
            });
        return {
            user_id: this.createId(info.user_id),
            user_name: info.nickname,
            remark: info.remark,
        };
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        const bot = this.requireBot(uin);
        const groups = await bot.getGroupList();

        return groups.map(group => ({
            group_id: this.createId(group.group_id),
            group_name: group.group_name,
            member_count: group.member_count,
            max_member_count: group.max_member_count,
        }));
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const bot = this.requireBot(uin);
        const info = await bot.getGroupInfo(params.group_id.string);

        if (!info) {
            throw new MockError(`Mock 群组 ${params.group_id.string} 不存在`, {
                code: "MOCK_GROUP_NOT_FOUND",
            });
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
        if (!member)
            throw new MockError(`Mock 群成员 ${params.user_id.string} 不存在`, {
                code: "MOCK_MEMBER_NOT_FOUND",
            });
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
            app_version: await readPackageVersion(import.meta.url),
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
            random_seed: config.random_seed,
            auto_event_types: config.auto_event_types,
            friends: config.friends,
            groups: config.groups,
        };

        const bot = new MockBot(mockConfig);
        const account = new Account<"mock", MockBot>(this, bot, config);

        bot.on("ready", user => {
            this.logger.info(`Mock Bot ${user.nickname} (${user.user_id}) 已就绪`);
            account.status = AccountStatus.Online;
            account.nickname = user.nickname;
            account.avatar = user.avatar ?? "";
        });

        bot.on("stopped", () => {
            account.status = AccountStatus.OffLine;
        });

        const projection = {
            botId: config.account_id,
            createId: (value: string | number) => this.createId(value),
        };
        bot.on("message", event => account.dispatchAwaited(projectMockMessage(event, projection)));
        bot.on("request", event => account.dispatchAwaited(projectMockRequest(event, projection)));
        bot.on("heartbeat", event =>
            account.dispatchAwaited(projectMockHeartbeat(event, projection)),
        );
        bot.on("client_error", error => this.logger.error("Mock Bot 异步事件失败", error));

        account.on("start", async () => {
            try {
                await bot.start();
            } catch (error) {
                this.logger.error(`启动 Mock Bot 失败:`, error);
                account.status = AccountStatus.OffLine;
                throw error;
            }
        });

        account.on("stop", async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });

        return account;
    }

    private requireBot(uin: string): MockBot {
        const account = this.getAccount(uin);
        if (!account)
            throw new MockError(`Mock 账号 ${uin} 不存在`, { code: "MOCK_ACCOUNT_NOT_FOUND" });
        return account.client;
    }

    private projectMember(groupId: CommonTypes.Id, member: MockMember): Adapter.GroupMemberInfo {
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
