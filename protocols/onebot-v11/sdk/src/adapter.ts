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
    type GroupMessageEvent,
    type WebSocketReceiverOptions,
} from "imhelper";
import {
    OneBotV11Event,
    OneBotV11Response,
    type OneBotV11ActionUrlResolver,
    type OneBotV11Call,
} from "./types.js";
import { HttpClient } from "./http-client.js";

export interface OneBotV11AdapterConfig {
    baseUrl: string;
    apiBaseUrl?: string;
    selfId: string;
    accessToken?: string;
    receiveMode: "ws" | "wss" | "webhook" | "sse" | "manual";
    path?: string; // webhook 路径
    wsUrl?: string; // WebSocket URL（可选，自动构建）
    platform?: string; // 平台名称（可选，用于构建 HTTP 路径）
    resolveActionUrl?: OneBotV11ActionUrlResolver;
    call?: OneBotV11Call;
    fetch?: typeof globalThis.fetch;
    webSocket?: Omit<WebSocketReceiverOptions, "accessToken">;
}
export type Segment = {
    type: string;
    data: Record<string, unknown>;
};

/**
 * 创建 OneBot V11 适配器
 */
export interface OneBotV11Adapter extends Adapter<number, OneBotV11Event> {
    sendMessage(options: Adapter.SendMessageOptions<number>): Promise<OneBotV11Response>;
    call<T = unknown>(
        action: string,
        params?: Record<string, unknown>,
    ): Promise<OneBotV11Response<T>>;
}

export function createOnebot11Adapter(config: OneBotV11AdapterConfig): OneBotV11Adapter {
    const { baseUrl, selfId, accessToken, receiveMode, path = "/onebot/v11", wsUrl } = config;

    // 解析 baseUrl 获取协议和主机
    const url = new URL(baseUrl);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const host = url.host;

    const nativeBaseUrl = `${url.origin}${url.pathname}`;
    const usesLegacyOneBotsRoutes =
        config.apiBaseUrl === undefined &&
        config.platform !== undefined &&
        (!url.pathname || url.pathname === "/");
    const legacyApiBaseUrl = `${url.origin}/${config.platform ?? "unknown"}/${selfId}/onebot/v11`;
    const eventBaseUrl = usesLegacyOneBotsRoutes ? legacyApiBaseUrl : nativeBaseUrl;
    const defaultWsUrl = wsUrl || `${protocol}//${host}${new URL(eventBaseUrl).pathname}`;

    class OneBotV11AdapterImpl extends Adapter<number, OneBotV11Event> implements OneBotV11Adapter {
        public readonly selfId: string = selfId;
        private httpClient: HttpClient;
        private receiver?:
            | WebSocketReceiver<number>
            | WSSReceiver<number>
            | WebhookReceiver<number>
            | SSEReceiver<number>;
        private readonly receiveMode: typeof receiveMode;
        private readonly defaultWsUrl: string;
        private readonly accessToken?: string;
        private readonly path: string;
        private readonly baseUrl: string;
        private readonly requestFlags = new Map<number, string>();
        private readonly requestIds = new Map<string, number>();
        private readonly requestSubTypes = new Map<number, "add" | "invite">();
        private nextRequestId = -1;

        constructor() {
            super();

            this.receiveMode = receiveMode;
            this.defaultWsUrl = defaultWsUrl;
            this.accessToken = accessToken;
            this.path = path;
            this.baseUrl = baseUrl;

            this.httpClient = new HttpClient({
                apiBaseUrl:
                    config.apiBaseUrl ?? (usesLegacyOneBotsRoutes ? legacyApiBaseUrl : nativeBaseUrl),
                accessToken,
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

        transformEvent(event: OneBotV11Event): void {
            this.transformAndEmit(event);
        }

        call<T = unknown>(
            action: string,
            params?: Record<string, unknown>,
        ): Promise<OneBotV11Response<T>> {
            return this.httpClient.post<T>(action, params);
        }

        private transformAndEmit(event: OneBotV11Event): void {
            // 转换为统一的事件格式
            if (event.post_type === "message") {
                const messageType = event.message_type || "private";
                const userId = event.user_id!;
                const messageId = event.message_id!;

                if (messageType === "private") {
                    const messageData: PrivateMessageEvent.Data<number> = {
                        timestamp: event.time,
                        bot_id: event.self_id,
                        message_id: messageId,
                        user_id: userId,
                        content: (event.message || []) as Message.Content,
                        message_type: "private",
                        raw_message: event.raw_message,
                    };
                    this.emit("message.private", messageData);
                } else {
                    const messageData: GroupMessageEvent.Data<number> = {
                        timestamp: event.time,
                        bot_id: event.self_id,
                        message_id: messageId,
                        user_id: userId,
                        group_id: event.group_id!,
                        content: (event.message || []) as Message.Content,
                        message_type: "group",
                        raw_message: event.raw_message,
                    };
                    this.emit("message.group", messageData);
                }
            } else if (event.post_type === "notice") {
                const base = { timestamp: event.time, bot_id: event.self_id };
                switch (event.notice_type) {
                    case "group_increase":
                        this.emit("notice.group_member_increase", {
                            ...base,
                            notice_type: "group_member_increase",
                            sub_type: event.sub_type === "invite" ? "invite" : "approve",
                            group_id: event.group_id!,
                            user_id: event.user_id!,
                            operator_id: event.operator_id,
                        });
                        break;
                    case "group_decrease":
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
                    case "group_recall":
                        this.emit("notice.group_message_delete", {
                            ...base,
                            notice_type: "group_message_delete",
                            sub_type: "delete",
                            group_id: event.group_id!,
                            message_id: event.message_id!,
                            operator_id: event.operator_id,
                        });
                        break;
                    case "friend_recall":
                        this.emit("notice.private_message_delete", {
                            ...base,
                            notice_type: "private_message_delete",
                            sub_type: "delete",
                            user_id: event.user_id!,
                            message_id: event.message_id!,
                        });
                        break;
                    case "friend_add":
                        this.emit("notice.friend_increase", {
                            ...base,
                            notice_type: "friend_increase",
                            sub_type: "add",
                            user_id: event.user_id!,
                        });
                        break;
                    case "friend_delete":
                        this.emit("notice.friend_decrease", {
                            ...base,
                            notice_type: "friend_decrease",
                            sub_type: "delete",
                            user_id: event.user_id!,
                        });
                        break;
                }
            } else if (event.post_type === "request" && event.flag) {
                const requestId = this.resolveRequestId(event.flag);
                if (event.request_type === "friend") {
                    this.emit("request.friend", {
                        timestamp: event.time,
                        bot_id: event.self_id,
                        request_id: requestId,
                        user_id: event.user_id!,
                        comment: event.comment,
                        flag: event.flag,
                    });
                } else if (event.request_type === "group") {
                    const subType = event.sub_type === "invite" ? "invite" : "add";
                    this.requestSubTypes.set(requestId, subType);
                    this.emit("request.group", {
                        timestamp: event.time,
                        bot_id: event.self_id,
                        request_id: requestId,
                        group_id: event.group_id!,
                        user_id: event.user_id!,
                        comment: event.comment,
                        flag: event.flag,
                        sub_type: subType,
                    });
                }
            } else if (event.post_type === "meta_event") {
                if (event.meta_event_type === "lifecycle") {
                    this.emit("meta.lifecycle", {
                        timestamp: event.time,
                        bot_id: event.self_id,
                        meta_type: "lifecycle",
                        sub_type:
                            event.sub_type === "enable" || event.sub_type === "disable"
                                ? event.sub_type
                                : "connect",
                    });
                } else if (event.meta_event_type === "heartbeat") {
                    this.emit("meta.heartbeat", {
                        timestamp: event.time,
                        bot_id: event.self_id,
                        meta_type: "heartbeat",
                        interval: event.interval,
                    });
                    if (event.status) {
                        this.emit("meta.status_update", {
                            timestamp: event.time,
                            bot_id: event.self_id,
                            meta_type: "status_update",
                            status: event.status,
                        });
                    }
                } else if (event.meta_event_type === "status_update" && event.status) {
                    this.emit("meta.status_update", {
                        timestamp: event.time,
                        bot_id: event.self_id,
                        meta_type: "status_update",
                        status: event.status,
                    });
                }
            }

            // 转发原始事件
            (this as EventEmitter).emit("event", event);
        }

        private resolveRequestId(flag: string): number {
            const numeric = Number(flag);
            if (Number.isFinite(numeric)) {
                this.requestFlags.set(numeric, flag);
                return numeric;
            }
            const existing = this.requestIds.get(flag);
            if (existing !== undefined) return existing;
            const requestId = this.nextRequestId;
            this.nextRequestId -= 1;
            this.requestIds.set(flag, requestId);
            this.requestFlags.set(requestId, flag);
            return requestId;
        }

        async sendMessage(options: Adapter.SendMessageOptions<number>): Promise<OneBotV11Response> {
            const { scene_type, scene_id, message } = options;

            if (scene_type === "private") {
                return this.httpClient.post("/send_private_msg", {
                    user_id: scene_id,
                    message,
                });
            } else {
                // group 或 channel（V11 中频道映射为群）
                return this.httpClient.post("/send_group_msg", {
                    group_id: scene_id,
                    message,
                });
            }
        }

        async recallMessage(message_id: number): Promise<boolean> {
            const response = await this.httpClient.post("/delete_msg", {
                message_id,
            });
            return response.status === "ok";
        }

        async getUserInfo(user_id: number): Promise<User<number>> {
            const response = await this.httpClient.post("/get_stranger_info", {
                user_id,
            });
            if (response.status === "ok" && response.data) {
                const data = response.data as Record<string, unknown>;
                const userData: User.Data<number> = {
                    user_id: data.user_id as number,
                    user_name: (data.nickname as string) || "",
                    avatar: (data.avatar as string) || "",
                };
                // 创建临时 User 实例，helper 会在使用时被替换
                return { info: userData } as unknown as User<number>;
            }
            throw new Error("Failed to get user info");
        }

        async getFriendInfo(user_id: number): Promise<Friend<number>> {
            // OneBot V11 没有单独的 get_friend_info，使用 get_stranger_info
            const user = await this.getUserInfo(user_id);
            const friendData: Friend.Data<number> = {
                ...user.info,
                remark: "",
            };
            return { info: friendData } as unknown as Friend<number>;
        }

        async getUserList(): Promise<User<number>[]> {
            // OneBot V11 没有 getUserList，返回空数组
            return [];
        }

        async getGroupInfo(group_id: number): Promise<Group<number>> {
            const response = await this.httpClient.post("/get_group_info", {
                group_id,
            });
            if (response.status === "ok" && response.data) {
                const data = response.data as Record<string, unknown>;
                const groupData: Group.Data<number> = {
                    group_id: data.group_id as number,
                    group_name: (data.group_name as string) || "",
                    avatar: "",
                };
                return { info: groupData } as unknown as Group<number>;
            }
            throw new Error("Failed to get group info");
        }

        async getGroupList(): Promise<Group<number>[]> {
            const response = await this.httpClient.post("/get_group_list", {});
            if (response.status === "ok" && Array.isArray(response.data)) {
                return (response.data as Array<Record<string, unknown>>).map(item => {
                    const groupData: Group.Data<number> = {
                        group_id: item.group_id as number,
                        group_name: (item.group_name as string) || "",
                        avatar: "",
                    };
                    return { info: groupData } as unknown as Group<number>;
                });
            }
            return [];
        }

        async getGroupMemberInfo(group_id: number, user_id: number): Promise<User<number>> {
            const response = await this.httpClient.post("/get_group_member_info", {
                group_id,
                user_id,
            });
            if (response.status === "ok" && response.data) {
                const data = response.data as Record<string, unknown>;
                const userData: User.Data<number> = {
                    user_id: data.user_id as number,
                    user_name: (data.nickname as string) || (data.card as string) || "",
                    avatar: (data.avatar as string) || "",
                };
                return { info: userData } as unknown as User<number>;
            }
            throw new Error("Failed to get group member info");
        }

        async getGroupMemberList(group_id: number): Promise<User<number>[]> {
            const response = await this.httpClient.post("/get_group_member_list", {
                group_id,
            });
            if (response.status === "ok" && Array.isArray(response.data)) {
                return (response.data as Array<Record<string, unknown>>).map(item => {
                    const userData: User.Data<number> = {
                        user_id: item.user_id as number,
                        user_name: (item.nickname as string) || (item.card as string) || "",
                        avatar: (item.avatar as string) || "",
                    };
                    return { info: userData } as unknown as User<number>;
                });
            }
            return [];
        }

        async kickGroupMember(group_id: number, user_id: number): Promise<void> {
            await this.httpClient.post("/set_group_kick", {
                group_id,
                user_id,
            });
        }

        async setGroupMemberMute(
            group_id: number,
            user_id: number,
            duration: number,
        ): Promise<void> {
            await this.httpClient.post("/set_group_ban", {
                group_id,
                user_id,
                duration,
            });
        }

        async setGroupMemberAdmin(
            group_id: number,
            user_id: number,
            admin: boolean = true,
        ): Promise<void> {
            await this.httpClient.post("/set_group_admin", {
                group_id,
                user_id,
                enable: admin,
            });
        }

        async setGroupMemberCard(group_id: number, user_id: number, card: string): Promise<void> {
            await this.httpClient.post("/set_group_card", {
                group_id,
                user_id,
                card,
            });
        }

        async setGroupName(group_id: number, name: string): Promise<void> {
            await this.httpClient.post("/set_group_name", {
                group_id,
                group_name: name,
            });
        }

        async leaveGroup(group_id: number): Promise<void> {
            await this.httpClient.post("/set_group_leave", {
                group_id,
            });
        }

        async approveFriendRequest(
            request_id: number,
            approve: boolean,
            comment?: string,
        ): Promise<void> {
            await this.httpClient.post("/set_friend_add_request", {
                flag: this.requestFlags.get(request_id) ?? String(request_id),
                approve,
                remark: comment,
            });
        }

        async approveGroupRequest(
            request_id: number,
            approve: boolean,
            reason?: string,
        ): Promise<void> {
            await this.httpClient.post("/set_group_add_request", {
                flag: this.requestFlags.get(request_id) ?? String(request_id),
                sub_type: this.requestSubTypes.get(request_id) ?? "add",
                approve,
                reason,
            });
        }

        async getMessage(message_id: number): Promise<import("imhelper").MessageEvent<number>> {
            const response = await this.httpClient.post("/get_msg", {
                message_id,
            });
            if (response.status === "ok" && response.data) {
                // 这里需要根据实际返回的数据构造 MessageEvent
                // 由于需要 helper 实例，这里暂时抛出错误，由调用方处理
                throw new Error(
                    "getMessage requires helper instance, use helper.getMessage instead",
                );
            }
            throw new Error("Failed to get message");
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

    return new OneBotV11AdapterImpl();
}
