import {
    Adapter,
    Message,
    ReceiveTransport,
    type Friend,
    type Group,
    type GroupMessageEvent,
    type PrivateMessageEvent,
    type User,
    type WebSocketReceiverOptions,
} from "imhelper";
import { HttpClient } from "./http-client.js";
import type {
    MilkyActionUrlResolver,
    MilkyCall,
    MilkyIncomingMessage,
    MilkyMessageId,
    MilkyMessageRecallData,
    MilkyMessageScene,
    MilkyV1Event,
    MilkyV1Response,
} from "./types.js";

export interface MilkyAdapterConfig {
    baseUrl: string;
    apiBaseUrl?: string;
    selfId: string;
    accessToken?: string;
    receiveMode: "ws" | "wss" | "webhook" | "sse" | "manual";
    path?: string;
    wsUrl?: string;
    resolveActionUrl?: MilkyActionUrlResolver;
    call?: MilkyCall;
    fetch?: typeof globalThis.fetch;
    webSocket?: Omit<WebSocketReceiverOptions, "accessToken">;
}

interface SendMessageResult {
    message_seq: number;
    time: number;
}

interface FriendRequestContext {
    initiatorUid: string;
    isFiltered: boolean;
}

type GroupRequestContext =
    | {
          kind: "request";
          notificationSeq: number;
          notificationType: "join_request" | "invited_join_request";
          groupId: number;
          isFiltered: boolean;
      }
    | { kind: "invitation"; invitationSeq: number; groupId: number };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isIncomingMessage(value: unknown): value is MilkyIncomingMessage {
    if (!isRecord(value)) return false;
    return (
        (value.message_scene === "friend" ||
            value.message_scene === "group" ||
            value.message_scene === "temp") &&
        typeof value.peer_id === "number" &&
        typeof value.message_seq === "number" &&
        typeof value.sender_id === "number" &&
        typeof value.time === "number" &&
        Array.isArray(value.segments)
    );
}

function isRecallData(value: unknown): value is MilkyMessageRecallData {
    if (!isRecord(value)) return false;
    return (
        (value.message_scene === "friend" ||
            value.message_scene === "group" ||
            value.message_scene === "temp") &&
        typeof value.peer_id === "number" &&
        typeof value.message_seq === "number"
    );
}

function createMessageId(
    scene: MilkyMessageScene,
    peerId: number,
    messageSeq: number,
): MilkyMessageId {
    return `milky:${scene}:${peerId}:${messageSeq}`;
}

function parseMessageId(messageId: string): {
    scene: MilkyMessageScene;
    peerId: number;
    messageSeq: number;
} {
    const match = /^milky:(friend|group|temp):(-?\d+):(-?\d+)$/.exec(messageId);
    if (!match) throw new TypeError(`无效的 Milky 消息 ID：${messageId}`);
    return {
        scene: match[1] as MilkyMessageScene,
        peerId: Number(match[2]),
        messageSeq: Number(match[3]),
    };
}

function resolveReceiveEndpoints(config: MilkyAdapterConfig): {
    ws: string;
    wss: string;
    webhook: string;
    sse: string;
} {
    const { baseUrl, path = "/milky/v1" } = config;
    const eventUrl = new URL(config.wsUrl ?? baseUrl);
    eventUrl.protocol = eventUrl.protocol === "https:" ? "wss:" : "ws:";
    if (!config.wsUrl) {
        eventUrl.pathname = `${eventUrl.pathname.replace(/\/+$/, "")}/event`;
    }

    const sseUrl = new URL(baseUrl);
    sseUrl.pathname = `${sseUrl.pathname.replace(/\/+$/, "")}/event`;
    return {
        ws: eventUrl.toString(),
        wss: eventUrl.pathname || path,
        webhook: path,
        sse: sseUrl.toString(),
    };
}

/** Milky V1 协议适配器。 */
export class MilkyV1Adapter extends Adapter<string, MilkyV1Event> {
    readonly selfId: string;
    readonly #config: MilkyAdapterConfig;
    readonly #httpClient: HttpClient;
    readonly #friendRequests = new Map<string, FriendRequestContext>();
    readonly #groupRequests = new Map<string, GroupRequestContext>();
    readonly #receiveTransport: ReceiveTransport<string, MilkyV1Event>;

    constructor(config: MilkyAdapterConfig) {
        super();
        this.#config = config;
        this.selfId = config.selfId;
        this.#httpClient = new HttpClient({
            apiBaseUrl: config.apiBaseUrl ?? config.baseUrl,
            accessToken: config.accessToken,
            resolveActionUrl: config.resolveActionUrl,
            call: config.call,
            fetch: config.fetch,
        });
        this.#receiveTransport = new ReceiveTransport(this, {
            mode: config.receiveMode,
            endpoints: resolveReceiveEndpoints(config),
            accessToken: config.accessToken,
            webSocket: config.webSocket,
        });
    }

    transformEvent(event: MilkyV1Event): void {
        if (event.event_type === "message_receive" && isIncomingMessage(event.data)) {
            this.#emitMessage(event, event.data);
        } else if (event.event_type === "message_recall" && isRecallData(event.data)) {
            this.#emitRecall(event, event.data);
        } else if (isRecord(event.data)) {
            this.#emitCanonicalEvent(event, event.data);
        }
        this.emit("event", event);
    }

    #emitCanonicalEvent(event: MilkyV1Event, data: Record<string, unknown>): void {
        const base = { timestamp: event.time, bot_id: String(event.self_id) };
        const groupId = String(data.group_id ?? data.peer_id ?? "");
        const userId = String(data.user_id ?? "");
        const operatorId = data.operator_id === undefined ? undefined : String(data.operator_id);
        switch (event.event_type) {
            case "group_member_increase":
                this.emit("notice.group_member_increase", {
                    ...base,
                    notice_type: "group_member_increase",
                    sub_type: data.invitor_id === undefined ? "approve" : "invite",
                    group_id: groupId,
                    user_id: userId,
                    operator_id: operatorId,
                });
                break;
            case "group_member_decrease":
                this.emit("notice.group_member_decrease", {
                    ...base,
                    notice_type: "group_member_decrease",
                    sub_type:
                        data.operator_id === undefined
                            ? "leave"
                            : String(data.user_id) === String(event.self_id)
                              ? "kick_me"
                              : "kick",
                    group_id: groupId,
                    user_id: userId,
                    operator_id: operatorId,
                });
                break;
            case "friend_request": {
                const initiatorUid = String(data.initiator_uid ?? "");
                const requestId = `friend:${initiatorUid}:${data.is_filtered === true ? 1 : 0}`;
                this.#friendRequests.set(requestId, {
                    initiatorUid,
                    isFiltered: data.is_filtered === true,
                });
                this.emit("request.friend", {
                    ...base,
                    request_id: requestId,
                    user_id: String(data.initiator_id ?? ""),
                    comment: typeof data.comment === "string" ? data.comment : undefined,
                    flag: requestId,
                });
                break;
            }
            case "group_join_request":
            case "group_invited_join_request": {
                const notificationType =
                    event.event_type === "group_invited_join_request"
                        ? "invited_join_request"
                        : "join_request";
                const notificationSeq = Number(data.notification_seq);
                const groupIdValue = Number(data.group_id);
                const requestId = `group:${notificationType}:${groupIdValue}:${notificationSeq}:${data.is_filtered === true ? 1 : 0}`;
                this.#groupRequests.set(requestId, {
                    kind: "request",
                    notificationSeq,
                    notificationType,
                    groupId: groupIdValue,
                    isFiltered: data.is_filtered === true,
                });
                this.emit("request.group", {
                    ...base,
                    request_id: requestId,
                    group_id: groupId,
                    user_id: String(
                        event.event_type === "group_invited_join_request"
                            ? (data.target_user_id ?? "")
                            : (data.initiator_id ?? ""),
                    ),
                    comment: typeof data.comment === "string" ? data.comment : undefined,
                    flag: requestId,
                    sub_type: event.event_type === "group_invited_join_request" ? "invite" : "add",
                });
                break;
            }
            case "group_invitation": {
                const groupIdValue = Number(data.group_id);
                const invitationSeq = Number(data.invitation_seq);
                const requestId = `invitation:${groupIdValue}:${invitationSeq}`;
                this.#groupRequests.set(requestId, {
                    kind: "invitation",
                    invitationSeq,
                    groupId: groupIdValue,
                });
                this.emit("request.group", {
                    ...base,
                    request_id: requestId,
                    group_id: String(groupIdValue),
                    user_id: String(data.initiator_id ?? ""),
                    flag: requestId,
                    sub_type: "invite",
                });
                break;
            }
            case "bot_offline":
                this.emit("meta.lifecycle", {
                    ...base,
                    meta_type: "lifecycle",
                    sub_type: "disable",
                });
                break;
        }
    }

    #emitMessage(event: MilkyV1Event, message: MilkyIncomingMessage): void {
        if (message.message_scene === "group") {
            const data: GroupMessageEvent.Data<string> = {
                timestamp: message.time,
                bot_id: String(event.self_id),
                message_id: createMessageId("group", message.peer_id, message.message_seq),
                user_id: String(message.sender_id),
                group_id: String(message.peer_id),
                content: message.segments as Message.Content,
                message_type: "group",
            };
            this.emit("message.group", data);
            return;
        }
        const data: PrivateMessageEvent.Data<string> = {
            timestamp: message.time,
            bot_id: String(event.self_id),
            message_id: createMessageId(
                message.message_scene,
                message.peer_id,
                message.message_seq,
            ),
            user_id: String(message.sender_id),
            content: message.segments as Message.Content,
            message_type: "private",
        };
        this.emit("message.private", data);
    }

    #emitRecall(event: MilkyV1Event, recall: MilkyMessageRecallData): void {
        if (recall.message_scene === "group") {
            this.emit("notice.group_message_delete", {
                timestamp: event.time,
                bot_id: String(event.self_id),
                notice_type: "group_message_delete",
                sub_type: "delete",
                message_id: createMessageId("group", recall.peer_id, recall.message_seq),
                group_id: String(recall.peer_id),
                operator_id: String(recall.operator_id),
            });
        } else {
            this.emit("notice.private_message_delete", {
                timestamp: event.time,
                bot_id: String(event.self_id),
                notice_type: "private_message_delete",
                sub_type: "delete",
                message_id: createMessageId(
                    recall.message_scene,
                    recall.peer_id,
                    recall.message_seq,
                ),
                user_id: String(recall.sender_id),
            });
        }
    }

    call<T = unknown>(
        action: string,
        params?: Record<string, unknown>,
    ): Promise<MilkyV1Response<T>> {
        return this.#httpClient.post<T>(action, params);
    }

    async sendMessage(
        options: Adapter.SendMessageOptions<string>,
    ): Promise<MilkyV1Response<SendMessageResult>> {
        const { scene_type, scene_id, message } = options;
        const isPrivate = scene_type === "private";
        const response = await this.call<SendMessageResult>(
            isPrivate ? "send_private_message" : "send_group_message",
            isPrivate
                ? { user_id: Number(scene_id), message }
                : { group_id: Number(scene_id), message },
        );
        return response;
    }

    async recallMessage(messageId: string): Promise<boolean> {
        const { scene, peerId, messageSeq } = parseMessageId(messageId);
        return this.recallMessageIn(scene, peerId, messageSeq);
    }

    async recallMessageIn(
        scene: MilkyMessageScene,
        peerId: number,
        messageSeq: number,
    ): Promise<boolean> {
        if (scene === "temp") {
            throw new Error("Milky 临时会话不支持通用撤回，请直接调用协议 action");
        }
        const response = await this.call(
            scene === "group" ? "recall_group_message" : "recall_private_message",
            scene === "group"
                ? { group_id: peerId, message_seq: messageSeq }
                : { user_id: peerId, message_seq: messageSeq },
        );
        return response.status === "ok";
    }

    async getUserInfo(userId: string): Promise<User<string>> {
        const response = await this.call<Record<string, unknown>>("get_user_profile", {
            user_id: Number(userId),
        });
        if (response.status !== "ok" || !response.data) {
            throw new Error("获取 Milky 用户信息失败");
        }
        return {
            info: {
                user_id: String(response.data.user_id ?? userId),
                user_name: (response.data.nickname as string) ?? "",
                avatar: (response.data.avatar_url as string) ?? "",
            },
        } as unknown as User<string>;
    }

    async getFriendInfo(userId: string): Promise<Friend<string>> {
        const response = await this.call<Record<string, unknown>>("get_friend_info", {
            user_id: Number(userId),
        });
        if (response.status !== "ok" || !response.data) {
            throw new Error("获取 Milky 好友信息失败");
        }
        const friend = isRecord(response.data.friend) ? response.data.friend : response.data;
        return {
            info: {
                user_id: String(friend.user_id ?? userId),
                user_name: (friend.nickname as string) ?? "",
                avatar: (friend.avatar_url as string) ?? "",
                remark: (friend.remark as string) ?? "",
            },
        } as unknown as Friend<string>;
    }

    async getUserList(): Promise<User<string>[]> {
        const response = await this.call<unknown>("get_friend_list", { no_cache: false });
        if (response.status !== "ok") return [];
        const data = response.data;
        const friends = Array.isArray(data)
            ? data
            : isRecord(data) && Array.isArray(data.friends)
              ? data.friends
              : [];
        return friends.filter(isRecord).map(
            friend =>
                ({
                    info: {
                        user_id: String(friend.user_id),
                        user_name: (friend.nickname as string) ?? "",
                        avatar: (friend.avatar_url as string) ?? "",
                    },
                }) as unknown as User<string>,
        );
    }

    async getGroupInfo(groupId: string): Promise<Group<string>> {
        const response = await this.call<Record<string, unknown>>("get_group_info", {
            group_id: Number(groupId),
            no_cache: false,
        });
        if (response.status !== "ok" || !response.data) {
            throw new Error("获取 Milky 群信息失败");
        }
        return {
            info: {
                group_id: String(response.data.group_id ?? groupId),
                group_name: (response.data.group_name as string) ?? "",
                avatar: (response.data.avatar_url as string) ?? "",
            },
        } as unknown as Group<string>;
    }

    async getGroupList(): Promise<Group<string>[]> {
        const response = await this.call<unknown>("get_group_list", { no_cache: false });
        if (response.status !== "ok") return [];
        const data = response.data;
        const groups = Array.isArray(data)
            ? data
            : isRecord(data) && Array.isArray(data.groups)
              ? data.groups
              : [];
        return groups.filter(isRecord).map(
            group =>
                ({
                    info: {
                        group_id: String(group.group_id),
                        group_name: (group.group_name as string) ?? "",
                        avatar: (group.avatar_url as string) ?? "",
                    },
                }) as unknown as Group<string>,
        );
    }

    async getGroupMemberInfo(groupId: string, userId: string): Promise<User<string>> {
        const response = await this.call<Record<string, unknown>>("get_group_member_info", {
            group_id: Number(groupId),
            user_id: Number(userId),
            no_cache: false,
        });
        if (response.status !== "ok" || !response.data) {
            throw new Error("获取 Milky 群成员信息失败");
        }
        const member = isRecord(response.data.member) ? response.data.member : response.data;
        return {
            info: {
                user_id: String(member.user_id ?? userId),
                user_name: (member.card as string) ?? (member.nickname as string) ?? "",
                avatar: (member.avatar_url as string) ?? "",
            },
        } as unknown as User<string>;
    }

    async getGroupMemberList(groupId: string): Promise<User<string>[]> {
        const response = await this.call<unknown>("get_group_member_list", {
            group_id: Number(groupId),
            no_cache: false,
        });
        if (response.status !== "ok" || !Array.isArray(response.data)) return [];
        return response.data.filter(isRecord).map(
            member =>
                ({
                    info: {
                        user_id: String(member.user_id),
                        user_name: (member.card as string) ?? (member.nickname as string) ?? "",
                        avatar: (member.avatar_url as string) ?? "",
                    },
                }) as unknown as User<string>,
        );
    }

    async kickGroupMember(groupId: string, userId: string): Promise<void> {
        await this.call("kick_group_member", {
            group_id: Number(groupId),
            user_id: Number(userId),
            reject_add_request: false,
        });
    }

    async setGroupMemberMute(groupId: string, userId: string, duration: number): Promise<void> {
        await this.call("set_group_member_mute", {
            group_id: Number(groupId),
            user_id: Number(userId),
            duration,
        });
    }

    async setGroupMemberAdmin(groupId: string, userId: string, admin = true): Promise<void> {
        await this.call("set_group_member_admin", {
            group_id: Number(groupId),
            user_id: Number(userId),
            enable: admin,
        });
    }

    async setGroupMemberCard(groupId: string, userId: string, card: string): Promise<void> {
        await this.call("set_group_member_card", {
            group_id: Number(groupId),
            user_id: Number(userId),
            card,
        });
    }

    async setGroupName(groupId: string, name: string): Promise<void> {
        await this.call("set_group_name", { group_id: Number(groupId), new_group_name: name });
    }

    async leaveGroup(groupId: string): Promise<void> {
        await this.call("quit_group", { group_id: Number(groupId), is_dismiss: false });
    }

    async approveFriendRequest(requestId: string, approve: boolean): Promise<void> {
        const context = this.#friendRequests.get(requestId);
        if (!context) throw new TypeError(`未知的 Milky 好友请求：${requestId}`);
        await this.call(approve ? "accept_friend_request" : "reject_friend_request", {
            initiator_uid: context.initiatorUid,
            is_filtered: context.isFiltered,
        });
    }

    async approveGroupRequest(requestId: string, approve: boolean, reason?: string): Promise<void> {
        const context = this.#groupRequests.get(requestId);
        if (!context) throw new TypeError(`未知的 Milky 群请求：${requestId}`);
        if (context.kind === "invitation") {
            await this.call(approve ? "accept_group_invitation" : "reject_group_invitation", {
                group_id: context.groupId,
                invitation_seq: context.invitationSeq,
            });
            return;
        }
        await this.call(approve ? "accept_group_request" : "reject_group_request", {
            notification_seq: context.notificationSeq,
            notification_type: context.notificationType,
            group_id: context.groupId,
            is_filtered: context.isFiltered,
            ...(approve ? {} : { reason }),
        });
    }

    async start(port?: number): Promise<void> {
        await this.#receiveTransport.connect(port);
    }

    async stop(): Promise<void> {
        await this.#receiveTransport.disconnect();
    }
}

export function createMilkyAdapter(config: MilkyAdapterConfig): MilkyV1Adapter {
    return new MilkyV1Adapter(config);
}
