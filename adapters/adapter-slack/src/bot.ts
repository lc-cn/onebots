/**
 * Slack Bot 客户端
 * 基于 @slack/web-api
 */
import { EventEmitter } from "node:events";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import type { Next, RouterContext } from "onebots";
import type {
    SlackConfig,
    SlackUser,
    SlackChannel,
    SlackWebhookBody,
    SlackBlock,
    SlackMessageOptions,
    SlackChatResult,
} from "./types.js";

interface SocketModeEnvelope {
    ack(): Promise<void>;
    body?: SlackWebhookBody;
    type?: string;
}

function isSocketModeEnvelope(value: unknown): value is SocketModeEnvelope {
    return typeof value === "object" && value !== null && "ack" in value;
}

export class SlackBot extends EventEmitter {
    private config: SlackConfig;
    private client: WebClient;
    private socketClient?: SocketModeClient;
    private me: SlackUser | null = null;

    constructor(config: SlackConfig) {
        super();
        this.config = config;

        // 创建 Slack WebClient 实例
        this.client = new WebClient(config.token);
        if (config.socket_mode) {
            if (!config.app_token) {
                throw new Error("Slack Socket Mode 需要 app_token");
            }
            this.socketClient = new SocketModeClient({
                appToken: config.app_token,
                autoReconnectEnabled: true,
            });
            this.socketClient.on("slack_event", async (payload: unknown) => {
                if (!isSocketModeEnvelope(payload)) return;
                await payload.ack();
                this.emitWebhookBody(payload.body ?? { type: payload.type });
            });
        }
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        try {
            // 获取 Bot 信息
            const authTest = await this.client.auth.test();

            this.me = {
                id: authTest.user_id || "",
                name: authTest.user || "",
            };

            if (this.socketClient) await this.socketClient.start();
            this.emit("ready");
        } catch (error) {
            this.emit("error", error);
            throw error;
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        if (this.socketClient) await this.socketClient.disconnect();
        this.emit("stopped");
    }

    /**
     * 处理 Webhook 请求（Events API）
     */
    async handleWebhook(ctx: RouterContext, next: Next): Promise<void> {
        if (this.config.signing_secret && !this.verifyWebhookSignature(ctx)) {
            ctx.status = 401;
            ctx.body = { ok: false, error: "invalid_signature" };
            return;
        }
        const body = ctx.request.body as SlackWebhookBody;

        // 处理 URL 验证（Slack 首次配置 webhook 时会发送验证请求）
        if (body.type === "url_verification") {
            ctx.body = { challenge: body.challenge };
            return;
        }

        // 处理事件
        this.emitWebhookBody(body);

        ctx.body = { ok: true };
        await next();
    }

    private verifyWebhookSignature(ctx: RouterContext): boolean {
        const timestamp = ctx.get("x-slack-request-timestamp");
        const signature = ctx.get("x-slack-signature");
        const rawBody = ctx.request.rawBody;
        if (!timestamp || !signature || typeof rawBody !== "string") return false;
        const timestampSeconds = Number(timestamp);
        if (
            !Number.isFinite(timestampSeconds) ||
            Math.abs(Date.now() / 1000 - timestampSeconds) > 300
        ) {
            return false;
        }
        const digest = `v0=${createHmac("sha256", this.config.signing_secret ?? "")
            .update(`v0:${timestamp}:${rawBody}`)
            .digest("hex")}`;
        const actual = Buffer.from(signature);
        const expected = Buffer.from(digest);
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    }

    /** 将 HTTP Events 与 Socket Mode 归一到同一个原始事件入口。 */
    private emitWebhookBody(body: SlackWebhookBody): void {
        this.emit("raw_event", body);
        if (body.event) {
            this.emit("event", body.event, body);
            return;
        }
        const eventType =
            typeof body.command === "string"
                ? "slash_command"
                : body.type && body.type !== "event_callback"
                  ? body.type
                  : undefined;
        if (eventType) {
            this.emit(
                "event",
                {
                    ...body,
                    type: eventType,
                    event_ts: String(body.event_time ?? Date.now() / 1000),
                },
                body,
            );
        }
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
            id: authTest.user_id || "",
            name: authTest.user || "",
        };
    }

    /**
     * 发送消息
     */
    async sendMessage(
        channel: string,
        text: string,
        options?: SlackMessageOptions,
    ): Promise<SlackChatResult> {
        const result = await this.client.chat.postMessage({
            channel,
            text,
            ...(options as Record<string, unknown>),
        });

        if (!result.ok) {
            throw new Error(`发送消息失败: ${result.error}`);
        }

        return result as unknown as SlackChatResult;
    }

    /**
     * 发送带 Blocks 的消息
     */
    async sendBlocks(
        channel: string,
        blocks: SlackBlock[],
        text?: string,
    ): Promise<SlackChatResult> {
        const result = await this.client.chat.postMessage({
            channel,
            blocks,
            text: text || " ",
        });

        if (!result.ok) {
            throw new Error(`发送消息失败: ${result.error}`);
        }

        return result as unknown as SlackChatResult;
    }

    /**
     * 更新消息
     */
    async updateMessage(
        channel: string,
        ts: string,
        text: string,
        options?: SlackMessageOptions,
    ): Promise<SlackChatResult> {
        const result = await this.client.chat.update({
            channel,
            ts,
            text,
            ...(options as Record<string, unknown>),
        });

        if (!result.ok) {
            throw new Error(`更新消息失败: ${result.error}`);
        }

        return result as unknown as SlackChatResult;
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
                types: types || "public_channel,private_channel",
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

    /** 获取工作区用户；Slack 以用户目录而非“好友关系”建模。 */
    async getUserList(): Promise<SlackUser[]> {
        const users: SlackUser[] = [];
        let cursor: string | undefined;
        do {
            const result = await this.client.users.list({ cursor, limit: 200 });
            if (!result.ok) throw new Error(`获取工作区用户失败: ${result.error}`);
            users.push(...((result.members ?? []) as SlackUser[]));
            cursor = result.response_metadata?.next_cursor || undefined;
        } while (cursor);
        return users;
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

    /** 创建工作区频道；Slack 的工作区由当前 token 隐式确定。 */
    async createChannel(name: string): Promise<SlackChannel> {
        const result = await this.client.conversations.create({ name });
        if (!result.ok || !result.channel?.id) {
            throw new Error(`创建频道失败: ${result.error ?? "响应缺少频道信息"}`);
        }
        return {
            id: result.channel.id,
            name: result.channel.name ?? name,
            is_channel: result.channel.is_channel,
            is_private: result.channel.is_private,
        };
    }

    /**
     * 踢出频道成员
     */
    async kickChannelMember(channelId: string, userId: string): Promise<boolean> {
        const result = await this.client.conversations.kick({ channel: channelId, user: userId });
        if (!result.ok) throw new Error(`移除频道成员失败: ${result.error}`);
        return result.ok;
    }

    /**
     * 获取 WebClient 实例（用于高级用法）
     */
    getWebClient(): WebClient {
        return this.client;
    }

    /** 调用 Slack Web API，供能力清单声明的平台扩展动作使用。 */
    async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        return this.client.apiCall(method, params);
    }
}
