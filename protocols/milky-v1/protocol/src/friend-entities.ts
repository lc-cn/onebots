import type { Adapter } from "onebots";
import type { Milky } from "./types.js";

/** 投影 canonical FriendEntity；QID 不可获取时按 Milky 非可空字段语义返回空串。 */
export function projectMilkyFriend(friend: Adapter.FriendInfo): Milky.FriendInfo {
    return {
        user_id: requirePositiveId(friend.user_id.number),
        nickname: friend.user_name,
        sex: friend.sex ?? "unknown",
        qid: friend.qid ?? "",
        remark: friend.remark ?? "",
        category: {
            category_id: requireCategoryId(friend.category_id),
            category_name: requireCategoryName(friend.category_name),
        },
    };
}

function requirePositiveId(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError("Adapter 返回的好友 user_id 必须是正整数 ID");
    }
    return value;
}

function requireCategoryId(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError("Adapter 返回的 category_id 必须是非负整数");
    }
    return value;
}

function requireCategoryName(value: unknown): string {
    if (typeof value !== "string") {
        throw new TypeError("Adapter 返回的 category_name 必须是字符串");
    }
    return value;
}
