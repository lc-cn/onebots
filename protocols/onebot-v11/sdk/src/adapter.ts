import {
    Adapter,
    ReceiveTransport,
    Message,
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
import { OneBotV11ResourceApi } from "./resource-api.js";

export interface OneBotV11AdapterConfig {
    baseUrl: string;
    apiBaseUrl?: string;
    selfId: string;
    accessToken?: string;
    receiveMode: "ws" | "wss" | "webhook" | "sse" | "manual";
    path?: string; // webhook 路径
    wsUrl?: string; // WebSocket URL（可选，自动构建）
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
    inviteFriendToGroup(groupId: number, userId: number): Promise<void>;
    acceptFriendRequest(flag: string, remark?: string): Promise<void>;
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
    url.protocol = protocol;
    const defaultWsUrl = wsUrl || url.toString();

    class OneBotV11AdapterImpl extends Adapter<number, OneBotV11Event> implements OneBotV11Adapter {
        public readonly selfId: string = selfId;
        private httpClient: HttpClient;
        private readonly resourceApi: OneBotV11ResourceApi;
        private readonly receiveTransport: ReceiveTransport<number, OneBotV11Event>;
        private readonly requestFlags = new Map<number, string>();
        private readonly requestIds = new Map<string, number>();
        private readonly requestSubTypes = new Map<number, "add" | "invite">();
        private nextRequestId = -1;

        constructor() {
            super();

            this.httpClient = new HttpClient({
                apiBaseUrl: config.apiBaseUrl ?? baseUrl,
                accessToken,
                resolveActionUrl: config.resolveActionUrl,
                call: config.call,
                fetch: config.fetch,
            });
            const numericSelfId = Number(selfId);
            if (!Number.isFinite(numericSelfId)) {
                throw new TypeError("OneBot V11 selfId 必须是有效数字");
            }
            this.resourceApi = new OneBotV11ResourceApi(
                (action, params) => this.httpClient.post(action, params),
                numericSelfId,
            );

            this.receiveTransport = new ReceiveTransport(this, {
                mode: receiveMode,
                endpoints: {
                    ws: defaultWsUrl,
                    wss: new URL(defaultWsUrl).pathname,
                    webhook: `/${selfId}${path}`,
                    sse: `${baseUrl.replace(/\/$/, "")}/events`,
                },
                accessToken,
                webSocket: config.webSocket,
            });
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
            this.emit("event", event);
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

        getUserInfo(userId: number) {
            return this.resourceApi.getUserInfo(userId);
        }

        getFriendInfo(userId: number) {
            return this.resourceApi.getFriendInfo(userId);
        }

        getUserList() {
            return this.resourceApi.getUserList();
        }

        getGroupInfo(groupId: number) {
            return this.resourceApi.getGroupInfo(groupId);
        }

        getGroupList() {
            return this.resourceApi.getGroupList();
        }

        getGroupMemberInfo(groupId: number, userId: number) {
            return this.resourceApi.getGroupMemberInfo(groupId, userId);
        }

        getGroupMemberList(groupId: number) {
            return this.resourceApi.getGroupMemberList(groupId);
        }

        async kickGroupMember(group_id: number, user_id: number): Promise<void> {
            await this.httpClient.post("/set_group_kick", {
                group_id,
                user_id,
            });
        }

        /** OneBots 扩展：邀请机器人好友加入指定群。 */
        async inviteFriendToGroup(groupId: number, userId: number): Promise<void> {
            await this.httpClient.post("/invite_friend_to_group", {
                group_id: groupId,
                user_id: userId,
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
            this.requestFlags.delete(request_id);
        }

        /** 使用申请事件中的 opaque flag 直接同意好友申请。 */
        async acceptFriendRequest(flag: string, remark?: string): Promise<void> {
            await this.httpClient.post("/accept_friend_request", { flag, remark });
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
            this.requestFlags.delete(request_id);
            this.requestSubTypes.delete(request_id);
        }

        getMessage(messageId: number) {
            return this.resourceApi.getMessage(messageId);
        }

        async start(port?: number): Promise<void> {
            await this.receiveTransport.connect(port);
        }

        async stop(): Promise<void> {
            await this.receiveTransport.disconnect();
        }
    }

    return new OneBotV11AdapterImpl();
}
