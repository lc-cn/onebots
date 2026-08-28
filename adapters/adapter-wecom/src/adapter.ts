/**
 * 企业微信适配器
 * 继承 Adapter 基类，实现企业微信平台功能
 */
import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    type CommonTypes,
} from "onebots";
import { WeComBot } from "./bot.js";
import { weComCapabilities } from "./capabilities.js";
import { projectWeComEvent } from "./events.js";
import type { WeComConfig, WeComEvent, WeComSendMessageRequest } from "./types.js";

export class WeComAdapter extends Adapter<WeComBot, "wecom"> {
    constructor(app: BaseApp) {
        super(app, "wecom", weComCapabilities);
        this.icon = "https://work.weixin.qq.com/favicon.ico";
    }

    // ============================================
    // 消息相关方法
    // ============================================

    /**
     * 发送消息
     */
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        // 解析消息内容
        let text = "";
        const request: WeComSendMessageRequest = {
            msgtype: "text",
            agentid: parseInt(bot.getCachedMe()?.userid || bot.getConfig().agent_id),
        };

        // 根据场景类型设置接收者
        if (scene_type === "private" || scene_type === "direct") {
            request.touser = sceneId.string;
        } else if (scene_type === "group") {
            // 企业微信群聊通过 toparty 或 totag
            request.toparty = sceneId.string;
        }

        for (const seg of message) {
            if (typeof seg === "string") {
                text += seg;
            } else if (seg.type === "text") {
                text += seg.data.text || "";
            } else if (seg.type === "at") {
                const userId = seg.data.qq || seg.data.id || seg.data.user_id;
                if (userId === "all") {
                    text += "@all ";
                } else {
                    text += `@${userId} `;
                }
            } else if (seg.type === "image") {
                // 企业微信图片消息需要先上传获取 media_id，这里简化处理
                if (seg.data.url || seg.data.file) {
                    text += `[图片: ${seg.data.url || seg.data.file}]`;
                }
            }
        }

        request.text = {
            content: text,
        };

        const result = await bot.sendMessage(request);

        return {
            message_id: this.createId(
                result.msgid || result.response_code || Date.now().toString(),
            ),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(_uin: string, _params: Adapter.DeleteMessageParams): Promise<void> {
        return this.unsupported(
            "delete_message",
            "platform_unsupported",
            "企业微信不支持撤回应用消息",
        );
    }

    /**
     * 获取消息
     */
    async getMessage(
        _uin: string,
        _params: Adapter.GetMessageParams,
    ): Promise<Adapter.MessageInfo> {
        return this.unsupported(
            "get_message",
            "platform_unsupported",
            "企业微信不支持主动获取应用消息",
        );
    }

    /**
     * 更新消息
     */
    async updateMessage(_uin: string, _params: Adapter.UpdateMessageParams): Promise<void> {
        return this.unsupported(
            "update_message",
            "platform_unsupported",
            "企业微信不支持更新应用消息",
        );
    }

    // ============================================
    // 用户相关方法
    // ============================================

    /**
     * 获取机器人自身信息
     */
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const me = bot.getCachedMe();

        return {
            user_id: this.createId(me?.userid || ""),
            user_name: me?.name || "",
            user_displayname: me?.name || "",
            avatar: me?.avatar,
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            user_id: this.createId(user.userid),
            user_name: user.name || "",
            user_displayname: user.name || "",
            avatar: user.avatar,
        };
    }

    // ============================================
    // 好友（私聊会话）相关方法
    // ============================================

    /**
     * 获取好友列表（企业微信不支持）
     */
    async getFriendList(
        _uin: string,
        _params?: Adapter.GetFriendListParams,
    ): Promise<Adapter.FriendInfo[]> {
        return this.unsupported(
            "get_friend_list",
            "platform_unsupported",
            "企业微信没有好友列表概念",
        );
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            user_id: this.createId(user.userid),
            user_name: user.name || "",
            remark: user.alias || user.name || "",
        };
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表（部门列表）
     */
    async getGroupList(
        uin: string,
        _params?: Adapter.GetGroupListParams,
    ): Promise<Adapter.GroupInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const departments = await bot.getDepartmentList();

        return departments.map(dept => ({
            group_id: this.createId(dept.id.toString()),
            group_name: dept.name || "",
        }));
    }

    /**
     * 获取群信息（部门信息）
     */
    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const deptId = parseInt(params.group_id.string);
        const departments = await bot.getDepartmentList(deptId);
        const dept = departments.find(d => d.id === deptId);

        if (!dept) {
            throw new Error(`部门 ${deptId} 不存在`);
        }

        return {
            group_id: this.createId(dept.id.toString()),
            group_name: dept.name || "",
        };
    }

    /**
     * 退出群组（企业微信不支持）
     */
    async leaveGroup(_uin: string, _params: Adapter.LeaveGroupParams): Promise<void> {
        return this.unsupported("leave_group", "platform_unsupported", "企业微信应用不能退出部门");
    }

    /**
     * 获取群成员列表（部门成员列表）
     */
    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const deptId = parseInt(params.group_id.string);
        const members = await bot.getDepartmentMembers(deptId);

        return members.map(user => ({
            group_id: params.group_id,
            user_id: this.createId(user.userid),
            user_name: user.name || "",
            card: user.alias || user.name || "",
            role: user.is_leader_in_dept?.some(
                (isLeader, idx) => isLeader === 1 && user.department?.[idx] === deptId,
            )
                ? "admin"
                : "member",
        }));
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);
        const deptId = parseInt(params.group_id.string);

        return {
            group_id: params.group_id,
            user_id: this.createId(user.userid),
            user_name: user.name || "",
            card: user.alias || user.name || "",
            role: user.is_leader_in_dept?.some(
                (isLeader, idx) => isLeader === 1 && user.department?.[idx] === deptId,
            )
                ? "admin"
                : "member",
        };
    }

    /**
     * 踢出群成员（企业微信不支持）
     */
    async kickGroupMember(_uin: string, _params: Adapter.KickGroupMemberParams): Promise<void> {
        return this.unsupported(
            "kick_group_member",
            "platform_unsupported",
            "企业微信应用不能从部门移除成员",
        );
    }

    /**
     * 设置群名片（企业微信不支持）
     */
    async setGroupCard(_uin: string, _params: Adapter.SetGroupCardParams): Promise<void> {
        return this.unsupported("set_group_card", "platform_unsupported", "企业微信部门没有群名片");
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots 企业微信 Adapter",
            app_version: "1.0.0",
            impl: "wecom",
            version: "1.0.0",
        };
    }

    /**
     * 获取运行状态
     */
    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    // ============================================
    // 账号创建
    // ============================================

    createAccount(config: Account.Config<"wecom">): Account<"wecom", WeComBot> {
        const wecomConfig: WeComConfig = {
            account_id: config.account_id,
            corp_id: config.corp_id,
            corp_secret: config.corp_secret,
            agent_id: config.agent_id,
            token: config.token,
            encoding_aes_key: config.encoding_aes_key,
        };

        const bot = new WeComBot(wecomConfig);
        const account = new Account<"wecom", WeComBot>(this, bot, config);

        // Webhook 路由（事件回调）
        this.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));

        // 监听 Bot 事件
        bot.on("ready", () => {
            this.logger.info(`企业微信 Bot ${config.account_id} 已就绪`);
        });

        bot.on("error", error => {
            this.logger.error(`企业微信 Bot ${config.account_id} 错误:`, error);
        });

        // 监听企业微信事件
        bot.on("event", (event: WeComEvent) => {
            this.handleWeComEvent(account, event);
        });

        // 启动时初始化 Bot
        account.on("start", async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                const me = bot.getCachedMe();
                account.nickname = me?.name || "企业微信 Bot";
                account.avatar = me?.avatar || this.icon;
            } catch (error) {
                this.logger.error(`启动企业微信 Bot 失败:`, error);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on("stop", async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });

        return account;
    }

    /**
     * 处理企业微信事件
     */
    private handleWeComEvent(account: Account<"wecom", WeComBot>, event: WeComEvent): void {
        account.dispatch(
            projectWeComEvent(event, {
                botId: account.config.account_id,
                createId: value => this.createId(value),
            }),
        );
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            wecom: WeComConfig;
        }
    }
}

AdapterRegistry.register("wecom", WeComAdapter, {
    name: "wecom",
    displayName: "企业微信官方机器人",
    description: "企业微信官方机器人适配器，支持应用消息推送、通讯录同步",
    icon: "https://work.weixin.qq.com/favicon.ico",
    homepage: "https://work.weixin.qq.com/",
    author: "凉菜",
    capabilities: weComCapabilities,
});
