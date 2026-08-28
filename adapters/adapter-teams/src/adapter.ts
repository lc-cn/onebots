/**
 * Microsoft Teams 适配器
 * 继承 Adapter 基类，实现 Microsoft Teams 平台功能
 */
import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    type CommonTypes,
} from "onebots";
import { TeamsBot } from "./bot.js";
import { teamsCapabilities } from "./capabilities.js";
import { projectTeamsEvent, type TeamsProjectionKind } from "./events.js";
import type { TeamsConfig, TeamsEvent } from "./types.js";

export class TeamsAdapter extends Adapter<TeamsBot, "teams"> {
    constructor(app: BaseApp) {
        super(app, "teams", teamsCapabilities);
        this.icon = "https://teams.microsoft.com/favicon.ico";
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
        const { message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        // 解析消息内容
        let text = "";
        const options: Record<string, unknown> = {};

        for (const seg of message) {
            if (typeof seg === "string") {
                text += seg;
            } else if (seg.type === "text") {
                text += seg.data.text || "";
            } else if (seg.type === "at") {
                const userId = seg.data.qq || seg.data.id || seg.data.user_id;
                if (userId === "all") {
                    text += "<at>所有人</at>";
                } else {
                    text += `<at>${userId}</at>`;
                }
            } else if (seg.type === "image") {
                // Teams 图片需要作为附件发送
                if (seg.data.url || seg.data.file) {
                    text += `[图片: ${seg.data.url || seg.data.file}]`;
                }
            } else if (seg.type === "file") {
                if (seg.data.url || seg.data.file) {
                    text += `[文件: ${seg.data.url || seg.data.file}]`;
                }
            }
        }

        // 发送消息
        const conversationId = sceneId.string;
        const result = await bot.sendMessage(conversationId, text, options);

        return {
            message_id: this.createId(result?.id || ""),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = this.coerceId(params.message_id as CommonTypes.Id | string | number).string;
        const conversationId =
            params.scene_id != null
                ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string
                : "";

        await bot.deleteMessage(conversationId, msgId);
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
        const config = account.config as TeamsConfig;

        return {
            user_id: this.createId(me?.id || config.app_id || ""),
            user_name: me?.name || "",
            user_displayname: me?.name || "",
            avatar: me?.avatar || "",
        };
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots Teams Adapter",
            app_version: "1.0.0",
            impl: "teams",
            version: "1.0.0",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    // ============================================
    // 账号管理
    // ============================================

    /**
     * 创建账号实例
     */
    createAccount(config: Account.Config<"teams">): Account<"teams", TeamsBot> {
        const teamsConfig: TeamsConfig = {
            account_id: config.account_id,
            app_id: config.app_id,
            app_password: config.app_password,
            webhook: config.webhook,
            channel_service: config.channel_service,
            open_id_metadata: config.open_id_metadata,
        };

        const bot = new TeamsBot(teamsConfig);
        const account = new Account<"teams", TeamsBot>(this, bot, config);

        // 注册 Webhook 路由
        this.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));

        // 监听 Bot 事件
        bot.on("ready", () => {
            this.logger.info(`Teams Bot ${config.account_id} 已就绪`);
            account.status = AccountStatus.Online;
        });

        bot.on("error", (error: Error) => {
            this.logger.error(`Teams Bot ${config.account_id} 错误:`, error);
            account.status = AccountStatus.OffLine;
            this.emit("error", { account_id: config.account_id, error });
        });

        bot.on("stopped", () => {
            account.status = AccountStatus.OffLine;
        });

        // 监听 Teams 事件并转换为适配器事件
        bot.on("private_message", (event: TeamsEvent) => {
            this.dispatchTeamsEvent(account, "private_message", event);
        });

        bot.on("group_message", (event: TeamsEvent) => {
            this.dispatchTeamsEvent(account, "group_message", event);
        });

        bot.on("message_edited", (event: TeamsEvent) => {
            this.dispatchTeamsEvent(account, "message_updated", event);
        });

        bot.on("message_deleted", (event: TeamsEvent) => {
            this.dispatchTeamsEvent(account, "message_deleted", event);
        });

        bot.on("member_joined", (event: TeamsEvent) => {
            this.dispatchTeamsEvent(account, "member_joined", event);
        });

        bot.on("member_left", (event: TeamsEvent) => {
            this.dispatchTeamsEvent(account, "member_left", event);
        });

        // 启动时初始化 Bot
        account.on("start", async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                const me = bot.getCachedMe();
                account.nickname = me?.name || "Teams Bot";
                account.avatar = me?.avatar || this.icon;
            } catch (error) {
                this.logger.error(`启动 Teams Bot 失败:`, error);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on("stop", async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });

        return account;
    }

    private dispatchTeamsEvent(
        account: Account<"teams", TeamsBot>,
        kind: TeamsProjectionKind,
        event: TeamsEvent,
    ): void {
        account.dispatch(
            projectTeamsEvent(kind, event, {
                botId: account.config.account_id,
                createId: value => this.createId(value),
            }),
        );
    }
}

// 声明类型扩展
declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            teams: TeamsConfig;
        }
    }
}

AdapterRegistry.register("teams", TeamsAdapter, {
    name: "teams",
    displayName: "Microsoft Teams",
    description: "Microsoft Teams Bot Framework 适配器，支持频道消息、私聊、自适应卡片",
    icon: "https://teams.microsoft.com/favicon.ico",
    homepage: "https://dev.botframework.com/",
    author: "凉菜",
    capabilities: teamsCapabilities,
});
