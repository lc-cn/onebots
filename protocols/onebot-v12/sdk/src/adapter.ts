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
    type GroupMessageEvent,
    type ChannelMessageEvent,
    type WebSocketReceiverOptions,
} from "imhelper";
import {
    OneBotV12Event,
    OneBotV12Response,
    type OneBotV12ActionUrlResolver,
    type OneBotV12Call,
} from "./types.js";
import { HttpClient } from "./http-client.js";

function malformed(action: string, response: OneBotV12Response<unknown>): never {
    throw new ProtocolError({
        protocol: "onebot-v12",
        operation: action,
        kind: "protocol",
        message: `OneBot V12 ${action} 返回了无效的数据结构`,
        response,
    });
}

function responseRecord(
    action: string,
    response: OneBotV12Response<unknown>,
): Record<string, unknown> {
    return typeof response.data === "object" &&
        response.data !== null &&
        !Array.isArray(response.data)
        ? (response.data as Record<string, unknown>)
        : malformed(action, response);
}

export interface OneBotV12AdapterConfig {
    baseUrl: string;
    apiBaseUrl?: string;
    selfId: string;
    accessToken?: string;
    receiveMode: "ws" | "wss" | "webhook" | "sse" | "manual";
    wsUrl?: string; // WebSocket URL（可选，自动构建）
    /** 事件缺少 self 时用于定位机器人状态，不参与地址拼接。 */
    platform?: string;
    resolveActionUrl?: OneBotV12ActionUrlResolver;
    call?: OneBotV12Call;
    fetch?: typeof globalThis.fetch;
    webSocket?: Omit<WebSocketReceiverOptions, "accessToken">;
}

export interface OneBotV12Adapter extends Adapter<string, OneBotV12Event> {
    sendMessage(options: Adapter.SendMessageOptions<string>): Promise<OneBotV12Response>;
    inviteFriendToGroup(groupId: string, userId: string): Promise<void>;
    acceptFriendRequest(flag: string, remark?: string): Promise<void>;
    call<T = unknown>(
        action: string,
        params?: Record<string, unknown>,
    ): Promise<OneBotV12Response<T>>;
}

export function createOnebot12Adapter(config: OneBotV12AdapterConfig): OneBotV12Adapter {
    const { baseUrl, selfId, accessToken, receiveMode, wsUrl } = config;
    const url = new URL(baseUrl);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.protocol = protocol;
    const defaultWsUrl = wsUrl || url.toString();

    class OneBotV12AdapterImpl extends Adapter<string, OneBotV12Event> implements OneBotV12Adapter {
        public readonly selfId: string = selfId;
        private httpClient: HttpClient;
        private readonly receiveTransport: ReceiveTransport<string, OneBotV12Event>;
        private readonly friendRequestFlags = new Map<string, string>();
        private readonly groupRequestContexts = new Map<
            string,
            { flag: string; subType: "add" | "invite" }
        >();

        constructor() {
            super();

            this.httpClient = new HttpClient({
                apiBaseUrl: config.apiBaseUrl ?? baseUrl,
                accessToken,
                resolveActionUrl: config.resolveActionUrl,
                call: config.call,
                fetch: config.fetch,
            });
            this.receiveTransport = new ReceiveTransport(this, {
                mode: receiveMode,
                endpoints: {
                    ws: defaultWsUrl,
                    wss: new URL(defaultWsUrl).pathname,
                    webhook: `/${selfId}/onebot/v12`,
                    sse: `${baseUrl.replace(/\/$/, "")}/events`,
                },
                accessToken,
                webSocket: config.webSocket,
            });
        }

        transformEvent(event: OneBotV12Event): void {
            this.transformAndEmit(event);
        }

        call<T = unknown>(
            action: string,
            params?: Record<string, unknown>,
        ): Promise<OneBotV12Response<T>> {
            return this.httpClient.post<T>(action, params);
        }

        private transformAndEmit(event: OneBotV12Event): void {
            const eventBotId = event.self?.user_id ?? selfId;
            if (event.type === "message") {
                const detailType = event.detail_type as "private" | "group" | "channel";
                const userId = event.user_id!;
                const messageId = event.message_id!;
                const timestamp = event.time;

                if (detailType === "private") {
                    const messageData: PrivateMessageEvent.Data<string> = {
                        timestamp,
                        bot_id: eventBotId,
                        message_id: messageId,
                        user_id: userId,
                        content: (event.message || []) as Message.Content,
                        message_type: "private",
                    };
                    this.emit("message.private", messageData);
                } else if (detailType === "group") {
                    const messageData: GroupMessageEvent.Data<string> = {
                        timestamp,
                        bot_id: eventBotId,
                        message_id: messageId,
                        user_id: userId,
                        group_id: event.group_id!,
                        content: (event.message || []) as Message.Content,
                        message_type: "group",
                    };
                    this.emit("message.group", messageData);
                } else if (detailType === "channel") {
                    const messageData: ChannelMessageEvent.Data<string> = {
                        timestamp,
                        bot_id: eventBotId,
                        message_id: messageId,
                        user_id: userId,
                        channel_id: event.channel_id!,
                        content: (event.message || []) as Message.Content,
                        message_type: "channel",
                    };
                    this.emit("message.channel", messageData);
                }
            } else if (event.type === "notice") {
                const base = { timestamp: event.time, bot_id: eventBotId };
                switch (event.detail_type) {
                    case "group_member_increase":
                        this.emit("notice.group_member_increase", {
                            ...base,
                            notice_type: "group_member_increase",
                            sub_type: event.sub_type === "invite" ? "invite" : "approve",
                            group_id: event.group_id!,
                            user_id: event.user_id!,
                            operator_id: event.operator_id,
                        });
                        break;
                    case "group_member_decrease":
                        this.emit("notice.group_member_decrease", {
                            ...base,
                            notice_type: "group_member_decrease",
                            sub_type:
                                event.sub_type === "kick" || event.sub_type === "kick_me"
                                    ? event.sub_type
                                    : "leave",
                            group_id: event.group_id!,
                            user_id: event.user_id!,
                            operator_id: event.operator_id,
                        });
                        break;
                    case "group_message_delete":
                        this.emit("notice.group_message_delete", {
                            ...base,
                            notice_type: "group_message_delete",
                            sub_type: "delete",
                            group_id: event.group_id!,
                            message_id: event.message_id!,
                            operator_id: event.operator_id,
                        });
                        break;
                    case "private_message_delete":
                        this.emit("notice.private_message_delete", {
                            ...base,
                            notice_type: "private_message_delete",
                            sub_type: "delete",
                            user_id: event.user_id!,
                            message_id: event.message_id!,
                        });
                        break;
                    case "friend_increase":
                        this.emit("notice.friend_increase", {
                            ...base,
                            notice_type: "friend_increase",
                            sub_type: "add",
                            user_id: event.user_id!,
                        });
                        break;
                    case "friend_decrease":
                        this.emit("notice.friend_decrease", {
                            ...base,
                            notice_type: "friend_decrease",
                            sub_type: "delete",
                            user_id: event.user_id!,
                        });
                        break;
                }
            } else if (event.type === "request") {
                if (event.detail_type === "friend" || event.detail_type === "friend_request") {
                    const requestId = event.request_id ?? event.id;
                    this.friendRequestFlags.set(requestId, event.flag ?? requestId);
                    this.emit("request.friend", {
                        timestamp: event.time,
                        bot_id: eventBotId,
                        request_id: requestId,
                        user_id: event.user_id!,
                        comment: typeof event.message === "string" ? event.message : event.comment,
                        flag: event.flag ?? requestId,
                    });
                } else if (event.detail_type === "group" || event.detail_type === "group_request") {
                    const requestId = event.request_id ?? event.id;
                    const subType = event.sub_type === "invite" ? "invite" : "add";
                    this.groupRequestContexts.set(requestId, {
                        flag: event.flag ?? requestId,
                        subType,
                    });
                    this.emit("request.group", {
                        timestamp: event.time,
                        bot_id: eventBotId,
                        request_id: requestId,
                        group_id: event.group_id!,
                        user_id: event.user_id!,
                        comment: typeof event.message === "string" ? event.message : event.comment,
                        flag: event.flag ?? requestId,
                        sub_type: subType,
                    });
                }
            } else if (event.type === "meta") {
                if (event.detail_type === "connect" || event.detail_type === "lifecycle") {
                    this.emit("meta.lifecycle", {
                        timestamp: event.time,
                        bot_id: eventBotId,
                        meta_type: "lifecycle",
                        sub_type:
                            event.sub_type === "enable" || event.sub_type === "disable"
                                ? event.sub_type
                                : "connect",
                    });
                } else if (event.detail_type === "heartbeat") {
                    this.emit("meta.heartbeat", {
                        timestamp: event.time,
                        bot_id: eventBotId,
                        meta_type: "heartbeat",
                        interval: event.interval,
                    });
                    if (event.status) {
                        const platform = event.self?.platform ?? config.platform;
                        const bot = event.status.bots.find(
                            item =>
                                item.self.user_id === eventBotId &&
                                (platform === undefined || item.self.platform === platform),
                        );
                        this.emit("meta.status_update", {
                            timestamp: event.time,
                            bot_id: eventBotId,
                            meta_type: "status_update",
                            status: { online: bot?.online ?? false, good: event.status.good },
                        });
                    }
                } else if (event.detail_type === "status_update" && event.status) {
                    const platform = event.self?.platform ?? config.platform;
                    const bot = event.status.bots.find(
                        item =>
                            item.self.user_id === eventBotId &&
                            (platform === undefined || item.self.platform === platform),
                    );
                    this.emit("meta.status_update", {
                        timestamp: event.time,
                        bot_id: eventBotId,
                        meta_type: "status_update",
                        status: { online: bot?.online ?? false, good: event.status.good },
                    });
                }
            }
            this.emit("event", event);
        }

        async sendMessage(options: Adapter.SendMessageOptions<string>): Promise<OneBotV12Response> {
            const { scene_type, scene_id, message } = options;
            const segments = Message.toSegments(message);

            return this.httpClient.post("/send_message", {
                detail_type: scene_type,
                ...(scene_type === "private" ? { user_id: scene_id } : {}),
                ...(scene_type === "group" ? { group_id: scene_id } : {}),
                ...(scene_type === "channel" ? { channel_id: scene_id } : {}),
                message: segments,
            });
        }

        async recallMessage(message_id: string): Promise<boolean> {
            const response = await this.httpClient.post("/delete_message", {
                message_id,
            });
            return response.status === "ok";
        }

        async getUserInfo(user_id: string): Promise<User.Data<string>> {
            const response = await this.httpClient.post<unknown>("/get_user_info", {
                user_id,
            });
            const data = responseRecord("get_user_info", response);
            return {
                user_id: typeof data.user_id === "string" ? data.user_id : user_id,
                user_name:
                    (typeof data.user_name === "string" && data.user_name) ||
                    (typeof data.nickname === "string" ? data.nickname : ""),
                avatar: typeof data.avatar === "string" ? data.avatar : "",
            };
        }

        async getFriendInfo(user_id: string): Promise<Friend.Data<string>> {
            const friends = await this.getFriendList();
            const friend = friends.find(item => item.user_id === user_id);
            if (friend) return friend;
            throw new ProtocolError({
                protocol: "onebot-v12",
                operation: "get_friend_list",
                kind: "validation",
                message: `OneBot V12 好友 ${user_id} 不存在`,
            });
        }

        async getUserList(): Promise<User.Data<string>[]> {
            return this.getFriendList();
        }

        private async getFriendList(): Promise<Friend.Data<string>[]> {
            const response = await this.httpClient.post<unknown>("/get_friend_list", {});
            if (!Array.isArray(response.data)) return malformed("get_friend_list", response);
            return response.data.map(item => {
                if (typeof item !== "object" || item === null) {
                    return malformed("get_friend_list", response);
                }
                const data = item as Record<string, unknown>;
                if (typeof data.user_id !== "string") {
                    return malformed("get_friend_list", response);
                }
                return {
                    user_id: data.user_id,
                    user_name: (data.user_name as string) || (data.nickname as string) || "",
                    avatar: (data.avatar as string) || "",
                    remark: (data.user_remark as string) || (data.remark as string) || undefined,
                };
            });
        }

        async getGroupInfo(group_id: string): Promise<Group.Data<string>> {
            const response = await this.httpClient.post<unknown>("/get_group_info", {
                group_id,
            });
            const data = responseRecord("get_group_info", response);
            return {
                group_id: typeof data.group_id === "string" ? data.group_id : group_id,
                group_name: typeof data.group_name === "string" ? data.group_name : "",
                avatar: typeof data.avatar === "string" ? data.avatar : "",
            };
        }

        async getGroupList(): Promise<Group.Data<string>[]> {
            const response = await this.httpClient.post<unknown>("/get_group_list", {});
            if (response.status === "ok" && Array.isArray(response.data)) {
                return response.data.map(item => {
                    if (typeof item !== "object" || item === null) {
                        return malformed("get_group_list", response);
                    }
                    const data = item as Record<string, unknown>;
                    if (typeof data.group_id !== "string") {
                        return malformed("get_group_list", response);
                    }
                    return {
                        group_id: data.group_id,
                        group_name: typeof data.group_name === "string" ? data.group_name : "",
                        avatar: typeof data.avatar === "string" ? data.avatar : "",
                    };
                });
            }
            return malformed("get_group_list", response);
        }

        async getGroupMemberInfo(
            group_id: string,
            user_id: string,
        ): Promise<GroupMember.Data<string>> {
            const response = await this.httpClient.post<unknown>("/get_group_member_info", {
                group_id,
                user_id,
            });
            const data = responseRecord("get_group_member_info", response);
            const role = data.role;
            return {
                user_id: typeof data.user_id === "string" ? data.user_id : user_id,
                user_name:
                    (typeof data.user_name === "string" && data.user_name) ||
                    (typeof data.nickname === "string" ? data.nickname : ""),
                avatar: typeof data.avatar === "string" ? data.avatar : "",
                group_id,
                role: role === "owner" || role === "admin" || role === "member" ? role : undefined,
            };
        }

        async getGroupMemberList(group_id: string): Promise<GroupMember.Data<string>[]> {
            const response = await this.httpClient.post<unknown>("/get_group_member_list", {
                group_id,
            });
            if (response.status === "ok" && Array.isArray(response.data)) {
                return response.data.map(item => {
                    if (typeof item !== "object" || item === null) {
                        return malformed("get_group_member_list", response);
                    }
                    const data = item as Record<string, unknown>;
                    if (typeof data.user_id !== "string") {
                        return malformed("get_group_member_list", response);
                    }
                    const role = data.role;
                    return {
                        user_id: data.user_id,
                        user_name:
                            (typeof data.user_name === "string" && data.user_name) ||
                            (typeof data.nickname === "string" ? data.nickname : ""),
                        avatar: typeof data.avatar === "string" ? data.avatar : "",
                        group_id,
                        role:
                            role === "owner" || role === "admin" || role === "member"
                                ? role
                                : undefined,
                    };
                });
            }
            return malformed("get_group_member_list", response);
        }

        /** OneBots 扩展：邀请机器人好友加入指定群。 */
        async inviteFriendToGroup(groupId: string, userId: string): Promise<void> {
            await this.httpClient.post("/invite_friend_to_group", {
                group_id: groupId,
                user_id: userId,
            });
        }

        /** 使用申请事件中的 opaque flag 直接同意好友申请。 */
        async acceptFriendRequest(flag: string, remark?: string): Promise<void> {
            await this.httpClient.post("/accept_friend_request", { flag, remark });
        }

        async approveFriendRequest(
            requestId: string,
            approve: boolean,
            comment?: string,
        ): Promise<void> {
            await this.httpClient.post("/handle_friend_request", {
                flag: this.friendRequestFlags.get(requestId) ?? requestId,
                approve,
                ...(approve ? { remark: comment } : { reason: comment }),
            });
            this.friendRequestFlags.delete(requestId);
        }

        async approveGroupRequest(
            requestId: string,
            approve: boolean,
            reason?: string,
        ): Promise<void> {
            const context = this.groupRequestContexts.get(requestId);
            if (!context) {
                throw new ProtocolError({
                    protocol: "onebot-v12",
                    operation: "approveGroupRequest",
                    kind: "validation",
                    message: `未知的 OneBot V12 群请求：${requestId}`,
                });
            }
            await this.httpClient.post("/handle_group_request", {
                flag: context.flag,
                sub_type: context.subType,
                approve,
                reason,
            });
            this.groupRequestContexts.delete(requestId);
        }

        async setGroupName(group_id: string, name: string): Promise<void> {
            await this.httpClient.post("/set_group_name", {
                group_id,
                group_name: name,
            });
        }

        async leaveGroup(group_id: string): Promise<void> {
            await this.httpClient.post("/leave_group", {
                group_id,
            });
        }

        async start(port?: number): Promise<void> {
            await this.receiveTransport.connect(port);
        }

        async stop(): Promise<void> {
            await this.receiveTransport.disconnect();
        }
    }

    return new OneBotV12AdapterImpl();
}
