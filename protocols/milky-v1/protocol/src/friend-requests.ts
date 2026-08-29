import {
    type Adapter,
    requireBooleanParam,
    requireNonEmptyStringParam,
    requirePositiveIntegerParam,
} from "onebots";

export const MILKY_FRIEND_REQUEST_ACTIONS = new Set([
    "accept_friend_request",
    "reject_friend_request",
]);

/** 获取完整 Milky FriendRequest 实体，不借用处理令牌伪装 UID。 */
export async function getMilkyFriendRequests(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const requests = await adapter.getFriendRequests(accountId, {
        limit: params.limit === undefined ? 20 : requirePositiveIntegerParam(params, "limit"),
        is_filtered: optionalBoolean(params, "is_filtered", false),
    });
    return {
        requests: requests.map(request => ({
            time: request.time,
            initiator_id: request.user_id.number,
            initiator_uid: requiredString(request.initiator_uid, "initiator_uid"),
            target_user_id: requiredId(request.target_user_id?.number, "target_user_id"),
            target_user_uid: requiredString(request.target_user_uid, "target_user_uid"),
            state: requiredState(request.state),
            comment: request.message ?? "",
            via: request.via ?? "",
            is_filtered: request.is_filtered ?? false,
        })),
    };
}

/** 使用 Milky 的发起者 UID 处理好友请求，opaque flag 仅留在 Adapter 内部。 */
export async function executeMilkyFriendRequestAction(
    adapter: Adapter,
    accountId: string,
    action: string,
    params: Record<string, unknown>,
): Promise<Record<string, never>> {
    const approve = action === "accept_friend_request";
    await adapter.handleFriendRequest(accountId, {
        initiator_uid: requireNonEmptyStringParam(params, "initiator_uid"),
        is_filtered: optionalBoolean(params, "is_filtered", false),
        approve,
        reason:
            !approve && params.reason !== undefined
                ? requireNonEmptyStringParam(params, "reason")
                : undefined,
    });
    return {};
}

function optionalBoolean(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
    return params[key] === undefined ? fallback : requireBooleanParam(params, key);
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`Adapter 返回的 ${field} 必须是非空字符串`);
    }
    return value;
}

function requiredId(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`Adapter 返回的 ${field} 必须是正整数 ID`);
    }
    return value;
}

function requiredState(value: unknown): "pending" | "accepted" | "rejected" | "ignored" {
    if (
        value !== "pending" &&
        value !== "accepted" &&
        value !== "rejected" &&
        value !== "ignored"
    ) {
        throw new TypeError("Adapter 返回的 state 不是合法好友请求状态");
    }
    return value;
}
