import {
    ProtocolError,
    type AnyMessageEventData,
    type Friend,
    type Group,
    type GroupMember,
    type Message,
    type User,
} from "imhelper";
import type { OneBotV11Response } from "./types.js";

export type OneBotV11SdkCaller = <T = unknown>(
    action: string,
    params?: Record<string, unknown>,
) => Promise<OneBotV11Response<T>>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function malformed(operation: string, response: OneBotV11Response<unknown>): never {
    throw new ProtocolError({
        protocol: "onebot-v11",
        operation,
        kind: "protocol",
        message: `OneBot V11 ${operation} 返回了无效的数据结构`,
        response,
    });
}

function dataRecord(
    operation: string,
    response: OneBotV11Response<unknown>,
): Record<string, unknown> {
    return isRecord(response.data) ? response.data : malformed(operation, response);
}

function dataRecords(
    operation: string,
    response: OneBotV11Response<unknown>,
): Record<string, unknown>[] {
    return Array.isArray(response.data)
        ? response.data.filter(isRecord)
        : malformed(operation, response);
}

function numberField(
    value: unknown,
    operation: string,
    response: OneBotV11Response<unknown>,
): number {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : malformed(operation, response);
}

function userData(data: Record<string, unknown>, userId: number): User.Data<number> {
    return {
        user_id: userId,
        user_name:
            (typeof data.card === "string" && data.card) ||
            (typeof data.nickname === "string" ? data.nickname : ""),
        avatar: typeof data.avatar === "string" ? data.avatar : "",
    };
}

/** OneBot V11 资源读取与 canonical DTO 投影的唯一边界。 */
export class OneBotV11ResourceApi {
    constructor(
        private readonly call: OneBotV11SdkCaller,
        private readonly selfId: number,
    ) {}

    async getUserInfo(userId: number): Promise<User.Data<number>> {
        const response = await this.call("get_stranger_info", { user_id: userId });
        const data = dataRecord("get_stranger_info", response);
        return userData(data, numberField(data.user_id, "get_stranger_info", response));
    }

    async getFriendInfo(userId: number): Promise<Friend.Data<number>> {
        const friends = await this.getFriendList();
        const friend = friends.find(item => item.user_id === userId);
        if (friend) return friend;
        throw new ProtocolError({
            protocol: "onebot-v11",
            operation: "get_friend_list",
            kind: "validation",
            message: `OneBot V11 好友 ${userId} 不存在`,
        });
    }

    async getUserList(): Promise<User.Data<number>[]> {
        return this.getFriendList();
    }

    async getFriendList(): Promise<Friend.Data<number>[]> {
        const response = await this.call("get_friend_list");
        return dataRecords("get_friend_list", response).map(item => ({
            ...userData(item, numberField(item.user_id, "get_friend_list", response)),
            remark: typeof item.remark === "string" ? item.remark : undefined,
        }));
    }

    async getGroupInfo(groupId: number): Promise<Group.Data<number>> {
        const response = await this.call("get_group_info", { group_id: groupId });
        const data = dataRecord("get_group_info", response);
        return this.toGroup(data, response);
    }

    async getGroupList(): Promise<Group.Data<number>[]> {
        const response = await this.call("get_group_list");
        return dataRecords("get_group_list", response).map(item => this.toGroup(item, response));
    }

    async getGroupMemberInfo(groupId: number, userId: number): Promise<GroupMember.Data<number>> {
        const response = await this.call("get_group_member_info", {
            group_id: groupId,
            user_id: userId,
        });
        return this.toGroupMember(groupId, dataRecord("get_group_member_info", response), response);
    }

    async getGroupMemberList(groupId: number): Promise<GroupMember.Data<number>[]> {
        const response = await this.call("get_group_member_list", { group_id: groupId });
        return dataRecords("get_group_member_list", response).map(item =>
            this.toGroupMember(groupId, item, response),
        );
    }

    async getMessage(messageId: number): Promise<AnyMessageEventData<number>> {
        const response = await this.call("get_msg", { message_id: messageId });
        const data = dataRecord("get_msg", response);
        const sender = isRecord(data.sender) ? data.sender : {};
        const userId = numberField(sender.user_id ?? data.user_id, "get_msg", response);
        const common = {
            timestamp: numberField(data.time, "get_msg", response),
            bot_id: this.selfId,
            message_id: numberField(data.message_id ?? messageId, "get_msg", response),
            user_id: userId,
            content: this.messageContent(data.message, data.raw_message),
            raw_message: typeof data.raw_message === "string" ? data.raw_message : undefined,
        };
        if (data.message_type === "private") {
            return { ...common, message_type: "private" };
        }
        if (data.message_type === "group") {
            return {
                ...common,
                message_type: "group",
                group_id: numberField(data.group_id, "get_msg", response),
            };
        }
        return malformed("get_msg", response);
    }

    private toGroup(
        data: Record<string, unknown>,
        response: OneBotV11Response<unknown>,
    ): Group.Data<number> {
        return {
            group_id: numberField(data.group_id, "get_group_info", response),
            group_name: typeof data.group_name === "string" ? data.group_name : "",
            avatar: typeof data.avatar === "string" ? data.avatar : "",
        };
    }

    private toGroupMember(
        groupId: number,
        data: Record<string, unknown>,
        response: OneBotV11Response<unknown>,
    ): GroupMember.Data<number> {
        const role = data.role;
        return {
            ...userData(data, numberField(data.user_id, "get_group_member_info", response)),
            group_id: groupId,
            role: role === "owner" || role === "admin" || role === "member" ? role : undefined,
            join_time: typeof data.join_time === "number" ? data.join_time : undefined,
            last_sent_time:
                typeof data.last_sent_time === "number" ? data.last_sent_time : undefined,
            level: typeof data.level === "string" ? data.level : undefined,
            title: typeof data.title === "string" ? data.title : undefined,
        };
    }

    private messageContent(message: unknown, rawMessage: unknown): Message.Content {
        if (typeof message === "string" || Array.isArray(message)) {
            return message as Message.Content;
        }
        return typeof rawMessage === "string" ? rawMessage : "";
    }
}
