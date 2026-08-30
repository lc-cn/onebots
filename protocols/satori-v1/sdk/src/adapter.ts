import {
    Adapter,
    ReceiveTransport,
    Message,
    ProtocolError,
    type User,
    type Group,
    type GroupMember,
    type Friend,
    type PrivateMessageEvent,
    type ChannelMessageEvent,
    type WebSocketReceiverOptions,
} from "imhelper";
import {
    SatoriV1Event,
    type SatoriActionUrlResolver,
    type SatoriCall,
    type SatoriGatewayPayload,
} from "./types.js";
import { HttpClient } from "./http-client.js";

export interface SatoriAdapterConfig {
    baseUrl: string;
    apiBaseUrl?: string;
    selfId: string;
    accessToken?: string;
    receiveMode: "ws" | "wss" | "webhook" | "sse" | "manual";
    path?: string; // webhook 路径
    wsUrl?: string; // WebSocket URL（可选，自动构建）
    platform: string;
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

function isGatewayPayload(
    event: SatoriV1Event | SatoriGatewayPayload,
): event is SatoriGatewayPayload {
    return typeof (event as { op?: unknown }).op === "number" && "body" in event;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function malformed(operation: string, response: unknown): never {
    throw new ProtocolError({
        protocol: "satori-v1",
        operation,
        kind: "protocol",
        message: `Satori ${operation} 返回了无效的数据结构`,
        response,
    });
}

async function collectList(
    operation: string,
    load: (next?: string) => Promise<unknown>,
): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = [];
    const visited = new Set<string>();
    let next: string | undefined;
    do {
        const response = await load(next);
        if (!isRecord(response) || !Array.isArray(response.data)) {
            return malformed(operation, response);
        }
        for (const item of response.data) {
            if (!isRecord(item)) return malformed(operation, response);
            result.push(item);
        }
        if (response.next !== undefined && typeof response.next !== "string") {
            return malformed(operation, response);
        }
        next = response.next as string | undefined;
        if (next && visited.has(next)) {
            return malformed(operation, response);
        }
        if (next) visited.add(next);
    } while (next);
    return result;
}

export function createSatoriAdapter(config: SatoriAdapterConfig): SatoriAdapter {
    const { baseUrl, selfId, accessToken, receiveMode, path = "/satori/v1", wsUrl } = config;

    // 解析 baseUrl 获取协议和主机
    const url = new URL(baseUrl);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";

    const eventUrl = new URL(baseUrl);
    eventUrl.protocol = protocol;
    if (!eventUrl.pathname.endsWith("/events")) {
        eventUrl.pathname = `${eventUrl.pathname.replace(/\/+$/, "")}/events`;
    }
    const defaultWsUrl = wsUrl || eventUrl.toString();

    class SatoriV1AdapterImpl extends Adapter<string, SatoriV1Event> implements SatoriAdapter {
        public readonly selfId: string = selfId;
        private httpClient: HttpClient;
        private readonly receiveTransport: ReceiveTransport<string, SatoriV1Event>;

        constructor() {
            super();

            this.httpClient = new HttpClient({
                apiBaseUrl: config.apiBaseUrl ?? baseUrl,
                accessToken,
                platform: config.platform,
                userId: selfId,
                resolveActionUrl: config.resolveActionUrl,
                call: config.call,
                fetch: config.fetch,
            });

            this.receiveTransport = new ReceiveTransport(this, {
                mode: receiveMode,
                endpoints: {
                    ws: defaultWsUrl,
                    wss: new URL(defaultWsUrl).pathname,
                    webhook: `/${selfId}${path}`,
                    sse: `${baseUrl.replace(/\/$/, "")}/events`,
                },
                accessToken,
                webSocket: {
                    ...config.webSocket,
                    onOpen: socket => {
                        socket.send(
                            JSON.stringify({
                                op: 3,
                                body: accessToken ? { token: accessToken } : {},
                            }),
                        );
                    },
                },
            });
        }

        transformEvent(event: SatoriV1Event | SatoriGatewayPayload): void {
            if (isGatewayPayload(event)) {
                if (event.op === 0) this.transformAndEmit(event.body);
                return;
            }
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
            const botId = event.login?.user?.id ?? this.selfId;

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
                } else if (
                    eventType === "message-deleted" &&
                    event.message &&
                    !event.guild &&
                    event.user
                ) {
                    // 公会频道删除事件没有对应 canonical 类型，仅从 raw event 保真转发。
                    this.emit("notice.private_message_delete", {
                        timestamp: Math.floor(event.timestamp / 1000),
                        bot_id: botId,
                        notice_type: "private_message_delete",
                        sub_type: "delete",
                        message_id: event.message.id,
                        user_id: event.user.id,
                    });
                }
            }
            // 群组成员事件
            else if (eventType === "guild-member-added" && event.guild && event.user) {
                this.emit("notice.group_member_increase", {
                    timestamp: Math.floor(event.timestamp / 1000),
                    bot_id: botId,
                    notice_type: "group_member_increase",
                    sub_type: "approve",
                    group_id: event.guild.id,
                    user_id: event.user.id,
                    operator_id: event.operator?.id,
                });
            } else if (eventType === "guild-member-removed" && event.guild && event.user) {
                this.emit("notice.group_member_decrease", {
                    timestamp: Math.floor(event.timestamp / 1000),
                    bot_id: botId,
                    notice_type: "group_member_decrease",
                    sub_type: event.operator ? "kick" : "leave",
                    group_id: event.guild.id,
                    user_id: event.user.id,
                    operator_id: event.operator?.id,
                });
            }
            // 好友请求事件
            else if (eventType === "friend-request") {
                const requestData = {
                    timestamp: Math.floor(event.timestamp / 1000),
                    bot_id: botId,
                    request_type: "friend",
                    request_id: String(event.id || Date.now()),
                    user_id: event.user?.id || "",
                    comment: (event.message?.content as string) || "",
                    flag: String(event.id || Date.now()),
                };

                this.emit("request.friend", requestData);
            }
            // 群组请求事件
            else if (eventType === "guild-request") {
                const requestData = {
                    timestamp: Math.floor(event.timestamp / 1000),
                    bot_id: botId,
                    request_type: "group",
                    request_id: String(event.id || Date.now()),
                    user_id: event.user?.id || "",
                    group_id: event.guild?.id || "",
                    comment: (event.message?.content as string) || "",
                    flag: String(event.id || Date.now()),
                    sub_type: "add" as const,
                };

                this.emit("request.group", requestData);
            }

            // 转发原始事件
            this.emit("event", event);
        }

        async sendMessage(options: Adapter.SendMessageOptions<string>): Promise<unknown> {
            const { scene_id, message } = options;

            // Satori 使用 message.create API
            return this.httpClient.post("/message.create", {
                channel_id: scene_id,
                content: message,
            });
        }

        async getUserInfo(user_id: string): Promise<User.Data<string>> {
            const data = await this.httpClient.post<Record<string, unknown>>("/user.get", {
                user_id,
            });
            const userData: User.Data<string> = {
                user_id: (data.id as string) || user_id,
                user_name: (data.name as string) || (data.username as string) || "",
                avatar: (data.avatar as string) || "",
            };
            return userData;
        }

        async getFriendInfo(user_id: string): Promise<Friend.Data<string>> {
            const friends = await this.getFriendList();
            const friend = friends.find(item => item.user_id === user_id);
            if (friend) return friend;
            throw new ProtocolError({
                protocol: "satori-v1",
                operation: "friend.list",
                kind: "validation",
                message: `Satori 好友 ${user_id} 不存在`,
            });
        }

        async getUserList(): Promise<User.Data<string>[]> {
            return this.getFriendList();
        }

        private async getFriendList(): Promise<Friend.Data<string>[]> {
            const friends = await collectList("friend.list", next =>
                this.httpClient.post("/friend.list", next ? { next } : {}),
            );
            return friends.map(friend => {
                if (typeof friend.id !== "string") return malformed("friend.list", friend);
                return {
                    user_id: friend.id,
                    user_name: (friend.name as string) || (friend.username as string) || "",
                    avatar: (friend.avatar as string) || "",
                };
            });
        }

        async getGroupInfo(group_id: string): Promise<Group.Data<string>> {
            // Satori 使用 guild.get API
            const data = await this.httpClient.post<Record<string, unknown>>("/guild.get", {
                guild_id: group_id,
            });
            const groupData: Group.Data<string> = {
                group_id: (data.id as string) || group_id,
                group_name: (data.name as string) || "",
                avatar: (data.avatar as string) || "",
            };
            return groupData;
        }

        async getGroupList(): Promise<Group.Data<string>[]> {
            const guilds = await collectList("guild.list", next =>
                this.httpClient.post("/guild.list", next ? { next } : {}),
            );
            return guilds.map(guild => {
                if (typeof guild.id !== "string") return malformed("guild.list", guild);
                return {
                    group_id: guild.id,
                    group_name: (guild.name as string) || "",
                    avatar: (guild.avatar as string) || "",
                };
            });
        }

        async getGroupMemberInfo(
            group_id: string,
            user_id: string,
        ): Promise<GroupMember.Data<string>> {
            const data = await this.httpClient.post<Record<string, unknown>>("/guild.member.get", {
                guild_id: group_id,
                user_id,
            });
            const userObj = data.user as Record<string, unknown> | undefined;
            const userData: GroupMember.Data<string> = {
                user_id: (userObj?.id as string) || (data.user_id as string) || user_id,
                user_name: (userObj?.name as string) || (data.nickname as string) || "",
                avatar: (userObj?.avatar as string) || (data.avatar as string) || "",
                group_id,
            };
            return userData;
        }

        async getGroupMemberList(group_id: string): Promise<GroupMember.Data<string>[]> {
            const members = await collectList("guild.member.list", next =>
                this.httpClient.post("/guild.member.list", {
                    guild_id: group_id,
                    ...(next ? { next } : {}),
                }),
            );
            return members.map(item => {
                const user = isRecord(item.user) ? item.user : undefined;
                const userId = user?.id ?? item.user_id;
                if (typeof userId !== "string") {
                    return malformed("guild.member.list", item);
                }
                return {
                    user_id: userId,
                    user_name:
                        (user?.name as string) ||
                        (item.nick as string) ||
                        (item.nickname as string) ||
                        "",
                    avatar: (user?.avatar as string) || (item.avatar as string) || "",
                    group_id,
                };
            });
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

        async start(port?: number): Promise<void> {
            await this.receiveTransport.connect(port);
        }

        async stop(): Promise<void> {
            await this.receiveTransport.disconnect();
        }
    }

    return new SatoriV1AdapterImpl();
}
