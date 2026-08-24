import { EventEmitter } from "events";
import {
    Adapter,
    WebSocketReceiver,
    WSSReceiver,
    WebhookReceiver,
    SSEReceiver,
    Message,
    type User,
    type Group,
    type Friend,
    type PrivateMessageEvent,
    type ChannelMessageEvent,
    type WebSocketReceiverOptions,
} from "imhelper";
import { SatoriV1Event, type SatoriActionUrlResolver, type SatoriCall } from "./types.js";
import { HttpClient } from "./http-client.js";

export interface SatoriAdapterConfig {
    baseUrl: string;
    apiBaseUrl?: string;
    selfId: string;
    accessToken?: string;
    receiveMode: "ws" | "wss" | "webhook" | "sse";
    path?: string; // webhook 路径
    wsUrl?: string; // WebSocket URL（可选，自动构建）
    platform?: string; // 平台名称（可选，用于构建 HTTP 路径）
    resolveActionUrl?: SatoriActionUrlResolver;
    call?: SatoriCall;
    fetch?: typeof globalThis.fetch;
    webSocket?: Omit<WebSocketReceiverOptions, "accessToken">;
}

/**
 * 创建 Satori V1 适配器
 */
export interface SatoriAdapter extends Adapter<string, SatoriV1Event> {
    sendMessage(options: Adapter.SendMessageOptions<string>): Promise<unknown>;
    call<T = unknown>(
        resource: string,
        method: string,
        params?: Record<string, unknown>,
    ): Promise<T>;
}

export function createSatoriAdapter(config: SatoriAdapterConfig): SatoriAdapter {
    const { baseUrl, selfId, accessToken, receiveMode, path = "/satori/v1", wsUrl } = config;

    // 解析 baseUrl 获取协议和主机
    const url = new URL(baseUrl);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const host = url.host;

    // 构建 WebSocket URL
    const defaultWsUrl = wsUrl || `${protocol}//${host}${url.pathname}`;
    const legacyApiBaseUrl = `${url.origin}/${config.platform ?? "unknown"}/${selfId}/satori/v1`;

    class SatoriV1AdapterImpl extends Adapter<string, SatoriV1Event> implements SatoriAdapter {
        public readonly selfId: string = selfId;
        private httpClient: HttpClient;
        private receiver?:
            | WebSocketReceiver<string>
            | WSSReceiver<string>
            | WebhookReceiver<string>
            | SSEReceiver<string>;
        private readonly receiveMode: typeof receiveMode;
        private readonly defaultWsUrl: string;
        private readonly accessToken?: string;
        private readonly path: string;
        private readonly baseUrl: string;

        constructor() {
            super();

            this.receiveMode = receiveMode;
            this.defaultWsUrl = defaultWsUrl;
            this.accessToken = accessToken;
            this.path = path;
            this.baseUrl = baseUrl;

            this.httpClient = new HttpClient({
                apiBaseUrl: config.apiBaseUrl ?? legacyApiBaseUrl,
                accessToken,
                platform: config.platform ?? "unknown",
                userId: selfId,
                unwrapLegacyResponse: config.apiBaseUrl === undefined,
                resolveActionUrl: config.resolveActionUrl,
                call: config.call,
                fetch: config.fetch,
            });

            this.setupReceiver();
        }

        private setupReceiver(): void {
            switch (this.receiveMode) {
                case "ws":
                    this.receiver = new WebSocketReceiver(this, this.defaultWsUrl, {
                        ...config.webSocket,
                        accessToken: this.accessToken,
                    });
                    break;
                case "wss":
                    const wssPath = new URL(this.defaultWsUrl).pathname;
                    this.receiver = new WSSReceiver(this, wssPath, this.accessToken);
                    break;
                case "webhook":
                    const webhookPath = `/${this.selfId}${this.path}`;
                    this.receiver = new WebhookReceiver(this, webhookPath, this.accessToken);
                    break;
                case "sse":
                    const sseUrl = `${this.baseUrl.replace(/\/$/, "")}/events`;
                    this.receiver = new SSEReceiver(this, sseUrl, this.accessToken);
                    break;
            }
        }

        transformEvent(event: SatoriV1Event): void {
            this.transformAndEmit(event);
        }

        call<T = unknown>(
            resource: string,
            method: string,
            params?: Record<string, unknown>,
        ): Promise<T> {
            return this.httpClient.call<T>(resource, method, params);
        }

        private transformAndEmit(event: SatoriV1Event): void {
            // Satori 事件格式转换
            const eventType = event.type || "";
            const botId =
                event.login?.user?.id ?? event.login?.self_id ?? event.self_id ?? this.selfId;

            // 消息事件
            if (eventType.startsWith("message-")) {
                if (eventType === "message-created" && event.message) {
                    // 判断是私聊还是群聊/频道
                    const channel = event.channel;
                    const guild = event.guild;
                    const userId = event.user?.id || "";
                    const messageId = event.message.id || String(Date.now());
                    const timestamp = Math.floor(
                        (event.message.created_at || event.timestamp) / 1000,
                    );

                    if (channel && guild) {
                        // 频道消息
                        const messageData: ChannelMessageEvent.Data<string> = {
                            timestamp,
                            bot_id: botId,
                            message_id: messageId,
                            user_id: userId,
                            channel_id: channel.id,
                            content: (typeof event.message.content === "string"
                                ? event.message.content
                                : event.message.content || []) as Message.Content,
                            message_type: "channel",
                        };
                        this.emit("message.channel", messageData);
                    } else {
                        // 私聊消息
                        const messageData: PrivateMessageEvent.Data<string> = {
                            timestamp,
                            bot_id: botId,
                            message_id: messageId,
                            user_id: userId,
                            content: (typeof event.message.content === "string"
                                ? event.message.content
                                : event.message.content || []) as Message.Content,
                            message_type: "private",
                        };
                        this.emit("message.private", messageData);
                    }
                } else if (eventType === "message-deleted" && event.message) {
                    // 消息删除通知
                    const noticeType = event.channel
                        ? "group_message_delete"
                        : "private_message_delete";
                    const noticeData: Record<string, unknown> = {
                        timestamp: Math.floor(event.timestamp / 1000),
                        bot_id: botId,
                        notice_type: noticeType,
                        message_id: event.message.id,
                    };

                    if (event.channel) {
                        noticeData.channel_id = event.channel.id;
                    }
                    if (event.user) {
                        noticeData.user_id = event.user.id;
                    }
                    if (event.operator) {
                        noticeData.operator_id = event.operator.id;
                    }

                    (this as EventEmitter).emit(`notice.${noticeType}`, noticeData);
                }
            }
            // 群组成员事件
            else if (eventType.startsWith("guild-member-")) {
                const noticeType =
                    eventType === "guild-member-added"
                        ? "group_member_increase"
                        : "group_member_decrease";
                const noticeData: Record<string, unknown> = {
                    timestamp: Math.floor(event.timestamp / 1000),
                    bot_id: botId,
                    notice_type: noticeType,
                };

                if (event.guild) {
                    noticeData.group_id = event.guild.id;
                }
                if (event.user) {
                    noticeData.user_id = event.user.id;
                }
                if (event.operator) {
                    noticeData.operator_id = event.operator.id;
                }

                (this as EventEmitter).emit(`notice.${noticeType}`, noticeData);
            }
            // 好友请求事件
            else if (eventType === "friend-request") {
                const requestData: Record<string, unknown> = {
                    timestamp: Math.floor(event.timestamp / 1000),
                    bot_id: botId,
                    request_type: "friend",
                    request_id: String(event.id || Date.now()),
                    user_id: event.user?.id || "",
                    comment: (event.message?.content as string) || "",
                    flag: String(event.id || Date.now()),
                };

                (this as EventEmitter).emit("request.friend", requestData);
            }
            // 群组请求事件
            else if (eventType === "guild-request") {
                const requestData: Record<string, unknown> = {
                    timestamp: Math.floor(event.timestamp / 1000),
                    bot_id: botId,
                    request_type: "group",
                    request_id: String(event.id || Date.now()),
                    user_id: event.user?.id || "",
                    group_id: event.guild?.id || "",
                    comment: (event.message?.content as string) || "",
                    flag: String(event.id || Date.now()),
                };

                (this as EventEmitter).emit("request.group", requestData);
            }

            // 转发原始事件
            (this as EventEmitter).emit("event", event);
        }

        async sendMessage(options: Adapter.SendMessageOptions<string>): Promise<unknown> {
            const { scene_type, scene_id, message } = options;

            // Satori 使用 message.create API
            return this.httpClient.post("/message.create", {
                channel_id: scene_id,
                content: message,
            });
        }

        async recallMessage(message_id: string): Promise<boolean> {
            // Satori 使用 message.delete API，但需要 channel_id
            // 由于我们没有 channel_id，这里暂时抛出错误
            throw new Error(
                "recallMessage requires channel_id in Satori, use deleteMessage instead",
            );
        }

        async getUserInfo(user_id: string): Promise<User<string>> {
            const data = await this.httpClient.post<Record<string, unknown>>("/user.get", {
                user_id,
            });
            const userData: User.Data<string> = {
                user_id: (data.id as string) || user_id,
                user_name: (data.name as string) || (data.username as string) || "",
                avatar: (data.avatar as string) || "",
            };
            return { info: userData } as unknown as User<string>;
        }

        async getFriendInfo(user_id: string): Promise<Friend<string>> {
            // Satori 没有单独的 get_friend_info，使用 get_user_info
            const user = await this.getUserInfo(user_id);
            const friendData: Friend.Data<string> = {
                ...user.info,
                remark: "",
            };
            return { info: friendData } as unknown as Friend<string>;
        }

        async getUserList(): Promise<User<string>[]> {
            // Satori 没有 getUserList，返回空数组
            return [];
        }

        async getGroupInfo(group_id: string): Promise<Group<string>> {
            // Satori 使用 guild.get API
            const data = await this.httpClient.post<Record<string, unknown>>("/guild.get", {
                guild_id: group_id,
            });
            const groupData: Group.Data<string> = {
                group_id: (data.id as string) || group_id,
                group_name: (data.name as string) || "",
                avatar: (data.avatar as string) || "",
            };
            return { info: groupData } as unknown as Group<string>;
        }

        async getGroupList(): Promise<Group<string>[]> {
            const response = await this.httpClient.post<unknown>("/guild.list", {});
            if (Array.isArray(response)) {
                return (response as Array<Record<string, unknown>>).map(item => {
                    const groupData: Group.Data<string> = {
                        group_id: item.id as string,
                        group_name: (item.name as string) || "",
                        avatar: (item.avatar as string) || "",
                    };
                    return { info: groupData } as unknown as Group<string>;
                });
            }
            return [];
        }

        async getGroupMemberInfo(group_id: string, user_id: string): Promise<User<string>> {
            const data = await this.httpClient.post<Record<string, unknown>>("/guild.member.get", {
                guild_id: group_id,
                user_id,
            });
            const userObj = data.user as Record<string, unknown> | undefined;
            const userData: User.Data<string> = {
                user_id: (userObj?.id as string) || (data.user_id as string) || user_id,
                user_name: (userObj?.name as string) || (data.nickname as string) || "",
                avatar: (userObj?.avatar as string) || (data.avatar as string) || "",
            };
            return { info: userData } as unknown as User<string>;
        }

        async getGroupMemberList(group_id: string): Promise<User<string>[]> {
            const response = await this.httpClient.post<unknown>("/guild.member.list", {
                guild_id: group_id,
            });
            if (Array.isArray(response)) {
                return (response as Array<Record<string, unknown>>).map(item => {
                    const userObj = item.user as Record<string, unknown> | undefined;
                    const userData: User.Data<string> = {
                        user_id: (userObj?.id as string) || (item.user_id as string),
                        user_name: (userObj?.name as string) || (item.nickname as string) || "",
                        avatar: (userObj?.avatar as string) || (item.avatar as string) || "",
                    };
                    return { info: userData } as unknown as User<string>;
                });
            }
            return [];
        }

        async kickGroupMember(group_id: string, user_id: string): Promise<void> {
            await this.httpClient.post("/guild.member.kick", {
                guild_id: group_id,
                user_id,
            });
        }

        async setGroupMemberMute(
            group_id: string,
            user_id: string,
            duration: number,
        ): Promise<void> {
            await this.httpClient.post("/guild.member.mute", {
                guild_id: group_id,
                user_id,
                duration,
            });
        }

        async getMessage(message_id: string): Promise<import("imhelper").MessageEvent<string>> {
            // Satori 的 message.get 需要 channel_id，这里暂时抛出错误
            throw new Error("getMessage requires channel_id in Satori");
        }

        async start(port?: number): Promise<void> {
            if (this.receiver) {
                if (this.receiveMode === "wss" || this.receiveMode === "webhook") {
                    await this.receiver.connect(port || 8080);
                } else {
                    // ws 和 sse 模式不需要 port 参数
                    await this.receiver.connect();
                }
            }
        }

        async stop(): Promise<void> {
            if (this.receiver) {
                await this.receiver.disconnect();
            }
        }
    }

    return new SatoriV1AdapterImpl();
}
