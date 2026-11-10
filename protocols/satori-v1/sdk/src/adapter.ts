import {
    Adapter,
    ReceiveTransport,
    Message,
    ProtocolError,
    type DirectoryQueryOptions,
    type PrivateMessageEvent,
    type ChannelMessageEvent,
    type WebSocketReceiverOptions,
} from "imhelper";
import {
    type SatoriAdapter,
    type SatoriActionUrlResolver,
    type SatoriCall,
    type SatoriGatewayPayload,
    type SatoriReplyMessageOptions,
    type SatoriSendMessageOptions,
    type SatoriV1Event,
} from "./types.js";
import { HttpClient } from "./http-client.js";
import { SatoriDirectoryApi, type SatoriSdkCaller } from "./directory-api.js";
import { isRecord, malformed } from "./protocol-data.js";
import { decodeSatoriContent, encodeSatoriContent } from "./message-codec.js";
import { SatoriReactionApi } from "./reaction-api.js";
import { MessageReferrerStore } from "./referrer-store.js";

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

function isGatewayPayload(
    event: SatoriV1Event | SatoriGatewayPayload,
): event is SatoriGatewayPayload {
    return typeof (event as { op?: unknown }).op === "number" && "body" in event;
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
        private readonly directoryApi: SatoriDirectoryApi;
        private readonly reactions: SatoriReactionApi;
        private readonly referrers = new MessageReferrerStore();
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
            const post: SatoriSdkCaller = <T = unknown>(
                action: string,
                params?: Record<string, unknown>,
            ) => this.httpClient.post<T>(action, params);
            this.directoryApi = new SatoriDirectoryApi(post);
            this.reactions = new SatoriReactionApi(post);

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
            if (event.message?.id && event.referrer) {
                this.referrers.remember(event.message.id, event.referrer);
            }
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
                            content: decodeSatoriContent(event.message.content ?? ""),
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
                            content: decodeSatoriContent(event.message.content ?? ""),
                            message_type: "private",
                            channel_id: channel?.id,
                        };
                        this.emit("message.private", messageData);
                    }
                } else if (eventType === "message-deleted" && event.message) {
                    if (event.guild && event.channel) {
                        this.emit("notice.channel_message_delete", {
                            timestamp: Math.floor(event.timestamp / 1000),
                            bot_id: botId,
                            notice_type: "channel_message_delete",
                            sub_type: "delete",
                            channel_id: event.channel.id,
                            guild_id: event.guild.id,
                            message_id: event.message.id,
                            user_id: event.user?.id,
                            operator_id: event.operator?.id,
                        });
                    } else if (event.user) {
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
                    comment:
                        typeof event.message?.content === "string" ? event.message.content : "",
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
                    comment:
                        typeof event.message?.content === "string" ? event.message.content : "",
                    flag: String(event.id || Date.now()),
                    sub_type: "add" as const,
                };

                this.emit("request.group", requestData);
            }

            // 转发原始事件
            this.emit("event", event);
        }

        async sendMessage(options: SatoriSendMessageOptions): Promise<unknown> {
            if (options.scene_type === "channel") {
                return this.createMessage(options.scene_id, options.message, options.referrer);
            }
            if (options.scene_type === "private") {
                const directChannel = await this.httpClient.post<unknown>("/user.channel.create", {
                    user_id: options.scene_id,
                });
                if (!isRecord(directChannel) || typeof directChannel.id !== "string") {
                    return malformed("user.channel.create", directChannel);
                }
                return this.createMessage(directChannel.id, options.message, options.referrer);
            }
            return this.unsupported("sendMessage:group");
        }

        async replyMessage(options: SatoriReplyMessageOptions): Promise<unknown> {
            const channelId = this.resolveChannelId(options);
            const referrer = options.referrer ?? this.referrers.recall(options.message_id);
            return channelId
                ? this.createMessage(channelId, options.message, referrer)
                : this.sendMessage({ ...options, referrer });
        }

        async recallMessageIn(options: Adapter.MessageContextOptions<string>): Promise<boolean> {
            const channelId = this.requireChannelId(options, "message.delete");
            await this.httpClient.post("/message.delete", {
                channel_id: channelId,
                message_id: options.message_id,
            });
            return true;
        }

        async updateMessageIn(options: Adapter.UpdateMessageOptions<string>): Promise<void> {
            const channelId = this.requireChannelId(options, "message.update");
            await this.httpClient.post("/message.update", {
                channel_id: channelId,
                message_id: options.message_id,
                content: encodeSatoriContent(options.content),
            });
        }

        async addMessageReactionIn(options: Adapter.MessageReactionOptions<string>): Promise<void> {
            const channelId = this.requireChannelId(options, "reaction.create");
            await this.reactions.create(channelId, options.message_id, options.reaction);
        }

        async deleteMessageReactionIn(
            options: Adapter.MessageReactionOptions<string>,
        ): Promise<void> {
            const channelId = this.requireChannelId(options, "reaction.delete");
            await this.reactions.delete(channelId, options.message_id, options.reaction);
        }

        deleteReaction(
            channelId: string,
            messageId: string,
            emojiId: string,
            userId?: string,
        ): Promise<void> {
            return this.reactions
                .delete(channelId, messageId, emojiId, userId)
                .then(() => undefined);
        }

        clearReaction(channelId: string, messageId: string, emojiId?: string): Promise<void> {
            return this.reactions.clear(channelId, messageId, emojiId).then(() => undefined);
        }

        listReactions(channelId: string, messageId: string, emojiId: string, next?: string) {
            return this.reactions.list(channelId, messageId, emojiId, next);
        }

        listFriends() {
            return this.directoryApi.listFriends();
        }

        getUserInfo(userId: string) {
            return this.directoryApi.getUserInfo(userId);
        }

        getFriendInfo(userId: string) {
            return this.directoryApi.getFriendInfo(userId);
        }

        getUserList() {
            return this.directoryApi.getUserList();
        }

        getGroupInfo(groupId: string) {
            return this.directoryApi.getGroupInfo(groupId);
        }

        getGroupList() {
            return this.directoryApi.getGroupList();
        }

        getGroupMemberInfo(groupId: string, userId: string) {
            return this.directoryApi.getGroupMemberInfo(groupId, userId);
        }

        getGroupMemberList(groupId: string) {
            return this.directoryApi.getGroupMemberList(groupId);
        }

        getChannelList(options?: DirectoryQueryOptions<string>) {
            return this.directoryApi.getChannelList(options);
        }

        getChannelInfo(channelId: string, options?: DirectoryQueryOptions<string>) {
            return this.directoryApi.getChannelInfo(channelId, options);
        }

        async setChannelName(channelId: string, name: string): Promise<void> {
            await this.httpClient.post("/channel.update", {
                channel_id: channelId,
                data: { name },
            });
        }

        async deleteFriend(userId: string): Promise<void> {
            await this.httpClient.post("/friend.delete", { user_id: userId });
        }

        async approveFriendRequest(
            requestId: string,
            approve: boolean,
            comment?: string,
        ): Promise<void> {
            await this.httpClient.post("/friend.approve", {
                message_id: requestId,
                approve,
                comment,
            });
        }

        async approveGroupRequest(
            requestId: string,
            approve: boolean,
            reason?: string,
        ): Promise<void> {
            await this.httpClient.post("/guild.approve", {
                message_id: requestId,
                approve,
                comment: reason,
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

        private createMessage(
            channelId: string,
            content: Message.Content,
            referrer?: object,
        ): Promise<unknown> {
            return this.httpClient.post("/message.create", {
                channel_id: channelId,
                content: encodeSatoriContent(content),
                ...(referrer !== undefined ? { referrer } : {}),
            });
        }

        private resolveChannelId(options: Adapter.MessageContextOptions<string>) {
            return (
                options.channel_id ??
                (options.scene_type === "channel" ? options.scene_id : undefined)
            );
        }

        private requireChannelId(
            options: Adapter.MessageContextOptions<string>,
            operation: string,
        ): string {
            const channelId = this.resolveChannelId(options);
            if (channelId) return channelId;
            throw new ProtocolError({
                protocol: "satori-v1",
                operation,
                kind: "validation",
                message: `Satori ${operation} 需要 channel_id 上下文`,
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
