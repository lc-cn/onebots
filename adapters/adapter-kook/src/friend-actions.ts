import type { Adapter, CommonTypes } from "onebots";
import type { KookBot } from "./bot.js";
import { KookError } from "./errors.js";
import type { KookUser } from "./types.js";

interface KookFriendRelation {
    id: number;
    type: "friend" | "request" | "block";
    friendInfo: KookUser;
    own: boolean;
}

/** KOOK 好友目录与申请处理；平台不提供好友变更推送，因此读取始终以 REST 为准。 */
export class KookFriendActions {
    constructor(private readonly createId: (value: string | number) => CommonTypes.Id) {}

    async getFriendList(bot: KookBot): Promise<Adapter.FriendInfo[]> {
        return (await this.relations(bot, "friend")).map(relation =>
            this.projectFriend(relation.friendInfo),
        );
    }

    async getFriendInfo(bot: KookBot, userId: string): Promise<Adapter.FriendInfo> {
        const relation = (await this.relations(bot, "friend")).find(
            item => item.friendInfo.id === userId,
        );
        if (!relation) {
            throw KookError.resource(`KOOK 好友不存在: ${userId}`, "KOOK_FRIEND_NOT_FOUND", {
                user_id: userId,
            });
        }
        return this.projectFriend(relation.friendInfo);
    }

    async deleteFriend(bot: KookBot, userId: string, block: boolean): Promise<void> {
        await bot.callApi("/v3/friend/delete", {
            method: "POST",
            body: { user_id: userId },
        });
        if (block) await this.blockUser(bot, userId);
    }

    async getFriendRequests(
        bot: KookBot,
        params?: Adapter.GetFriendRequestsParams,
    ): Promise<Adapter.FriendRequest[]> {
        if (params?.is_filtered) return [];
        const limit = optionalLimit(params?.limit);
        const requests = (await this.relations(bot, "request"))
            .filter(relation => !relation.own)
            .map(relation => ({
                request_id: this.createId(relation.id),
                user_id: this.createId(relation.friendInfo.id),
                user_name: relation.friendInfo.nickname || relation.friendInfo.username,
                time: 0,
                state: "pending" as const,
                initiator_uid: relation.friendInfo.id,
                via: "kook_friend_request",
                is_filtered: false,
            }));
        return limit === undefined ? requests : requests.slice(0, limit);
    }

    async handleFriendRequest(
        bot: KookBot,
        params: Adapter.HandleFriendRequestParams,
    ): Promise<void> {
        if (params.is_filtered) {
            throw KookError.invalid(
                "KOOK 不支持处理风险过滤好友申请",
                "KOOK_FILTERED_FRIEND_REQUEST_UNSUPPORTED",
            );
        }
        if (params.remark || params.reason) {
            throw KookError.invalid(
                "KOOK 处理好友申请不支持备注或拒绝理由",
                "KOOK_FRIEND_REQUEST_COMMENT_UNSUPPORTED",
            );
        }
        if (params.approve && params.block) {
            throw KookError.invalid(
                "KOOK 不能在同意好友申请时屏蔽用户",
                "KOOK_FRIEND_REQUEST_BLOCK_CONFLICT",
            );
        }
        const requestId = requireRequestId(params.request_id?.source ?? params.flag);
        await bot.callApi("/v3/friend/handle-request", {
            method: "POST",
            body: { id: requestId, accept: params.approve },
        });
        if (!params.approve && params.block) {
            const userId = requireUserId(params.initiator_uid);
            await this.blockUser(bot, userId);
        }
    }

    private blockUser(bot: KookBot, userId: string): Promise<unknown> {
        return bot.callApi("/v3/friend/block", {
            method: "POST",
            body: { user_id: userId },
        });
    }

    private async relations(
        bot: KookBot,
        kind: "friend" | "request",
    ): Promise<KookFriendRelation[]> {
        const response = await bot.callApi<unknown>("/v3/friend", { query: { type: kind } });
        return parseRelations(response, kind);
    }

    private projectFriend(user: KookUser): Adapter.FriendInfo {
        return {
            user_id: this.createId(user.id),
            user_name: user.username,
            remark: user.nickname && user.nickname !== user.username ? user.nickname : undefined,
        };
    }
}

function parseRelations(value: unknown, kind: "friend" | "request"): KookFriendRelation[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalidFriendResponse(kind);
    }
    const entries = (value as Record<string, unknown>)[kind];
    if (!Array.isArray(entries)) throw invalidFriendResponse(kind);
    return entries.map((entry, index) => parseRelation(entry, kind, index));
}

function parseRelation(
    value: unknown,
    kind: "friend" | "request",
    index: number,
): KookFriendRelation {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalidFriendResponse(kind, index);
    }
    const relation = value as Record<string, unknown>;
    const id = Number(relation.id);
    const friendInfo = relation.friend_info;
    if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        relation.type !== kind ||
        typeof relation.own !== "boolean" ||
        !friendInfo ||
        typeof friendInfo !== "object" ||
        Array.isArray(friendInfo)
    ) {
        throw invalidFriendResponse(kind, index);
    }
    const user = friendInfo as Record<string, unknown>;
    if (typeof user.id !== "string" || !user.id || typeof user.username !== "string") {
        throw invalidFriendResponse(kind, index);
    }
    return { id, type: kind, own: relation.own, friendInfo: friendInfo as KookUser };
}

function optionalLimit(value: number | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw KookError.invalid(
            "KOOK 好友申请 limit 必须为正整数",
            "KOOK_FRIEND_REQUEST_LIMIT_INVALID",
        );
    }
    return value;
}

function requireRequestId(value: unknown): number {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw KookError.invalid(
            "KOOK 好友申请必须提供正整数 request_id 或 flag",
            "KOOK_FRIEND_REQUEST_ID_INVALID",
        );
    }
    return id;
}

function requireUserId(value: unknown): string {
    if (typeof value === "string" && value.trim()) return value.trim();
    throw KookError.invalid(
        "KOOK 屏蔽被拒绝的申请人时必须提供 initiator_uid",
        "KOOK_FRIEND_REQUEST_USER_REQUIRED",
    );
}

function invalidFriendResponse(kind: string, index?: number): KookError {
    return KookError.resource(
        `KOOK ${kind} 关系响应${index === undefined ? "" : `第 ${index + 1} 项`}无效`,
        "KOOK_FRIEND_RESPONSE_INVALID",
        { kind, index },
    );
}
