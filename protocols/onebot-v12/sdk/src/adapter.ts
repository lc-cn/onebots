import { EventEmitter } from "events";
import {
    Adapter,
    ReceiveTransport,
    Message,
    type User,
    type Group,
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
                    this.emit("request.friend", {
                        timestamp: event.time,
                        bot_id: eventBotId,
                        request_id: requestId,
                        user_id: event.user_id!,
                        comment: typeof event.message === "string" ? event.message : event.comment,
                        flag: requestId,
                    });
                } else if (event.detail_type === "group" || event.detail_type === "group_request") {
                    const requestId = event.request_id ?? event.id;
                    this.emit("request.group", {
                        timestamp: event.time,
                        bot_id: eventBotId,
                        request_id: requestId,
                        group_id: event.group_id!,
                        user_id: event.user_id!,
                        comment: typeof event.message === "string" ? event.message : event.comment,
                        flag: requestId,
                        sub_type: event.sub_type === "invite" ? "invite" : "add",
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
            (this as EventEmitter).emit("event", event);
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

        async getUserInfo(user_id: string): Promise<User<string>> {
            const response = await this.httpClient.post("/get_user_info", {
                user_id,
            });
            if (response.status === "ok" && response.data) {
                const data = response.data as Record<string, unknown>;
                const userData: User.Data<string> = {
                    user_id: (data.user_id as string) || user_id,
                    user_name: (data.user_name as string) || (data.nickname as string) || "",
                    avatar: (data.avatar as string) || "",
                };
                return { info: userData } as unknown as User<string>;
            }
            throw new Error("Failed to get user info");
        }

        async getFriendInfo(user_id: string): Promise<Friend<string>> {
            // OneBot V12 没有单独的 get_friend_info，使用 get_user_info
            const user = await this.getUserInfo(user_id);
            const friendData: Friend.Data<string> = {
                ...user.info,
                remark: "",
            };
            return { info: friendData } as unknown as Friend<string>;
        }

        async getUserList(): Promise<User<string>[]> {
            // OneBot V12 没有 getUserList，返回空数组
            return [];
        }

        async getGroupInfo(group_id: string): Promise<Group<string>> {
            const response = await this.httpClient.post("/get_group_info", {
                group_id,
            });
            if (response.status === "ok" && response.data) {
                const data = response.data as Record<string, unknown>;
                const groupData: Group.Data<string> = {
                    group_id: (data.group_id as string) || group_id,
                    group_name: (data.group_name as string) || "",
                    avatar: (data.avatar as string) || "",
                };
                return { info: groupData } as unknown as Group<string>;
            }
            throw new Error("Failed to get group info");
        }

        async getGroupList(): Promise<Group<string>[]> {
            const response = await this.httpClient.post("/get_group_list", {});
            if (response.status === "ok" && Array.isArray(response.data)) {
                return (response.data as Array<Record<string, unknown>>).map(item => {
                    const groupData: Group.Data<string> = {
                        group_id: item.group_id as string,
                        group_name: (item.group_name as string) || "",
                        avatar: (item.avatar as string) || "",
                    };
                    return { info: groupData } as unknown as Group<string>;
                });
            }
            return [];
        }

        async getGroupMemberInfo(group_id: string, user_id: string): Promise<User<string>> {
            const response = await this.httpClient.post("/get_group_member_info", {
                group_id,
                user_id,
            });
            if (response.status === "ok" && response.data) {
                const data = response.data as Record<string, unknown>;
                const userData: User.Data<string> = {
                    user_id: (data.user_id as string) || user_id,
                    user_name: (data.user_name as string) || (data.nickname as string) || "",
                    avatar: (data.avatar as string) || "",
                };
                return { info: userData } as unknown as User<string>;
            }
            throw new Error("Failed to get group member info");
        }

        async getGroupMemberList(group_id: string): Promise<User<string>[]> {
            const response = await this.httpClient.post("/get_group_member_list", {
                group_id,
            });
            if (response.status === "ok" && Array.isArray(response.data)) {
                return (response.data as Array<Record<string, unknown>>).map(item => {
                    const userData: User.Data<string> = {
                        user_id: item.user_id as string,
                        user_name: (item.user_name as string) || (item.nickname as string) || "",
                        avatar: (item.avatar as string) || "",
                    };
                    return { info: userData } as unknown as User<string>;
                });
            }
            return [];
        }

        async kickGroupMember(group_id: string, user_id: string): Promise<void> {
            // OneBot V12 没有直接的 kick 方法，可能需要使用其他 API
            throw new Error("kickGroupMember not supported in OneBot V12");
        }

        async setGroupMemberMute(
            group_id: string,
            user_id: string,
            duration: number,
        ): Promise<void> {
            // OneBot V12 没有直接的 mute 方法
            throw new Error("setGroupMemberMute not supported in OneBot V12");
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

        async getMessage(message_id: string): Promise<import("imhelper").MessageEvent<string>> {
            // OneBot V12 没有 get_message API
            throw new Error("getMessage not supported in OneBot V12");
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
