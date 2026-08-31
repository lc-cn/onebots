import type { CommonEvent } from "onebots";

/** 将通用成员事件映射到 OneBot V11 规定的群成员通知。 */
export function projectOneBotV11Notice(event: CommonEvent.Notice): Record<string, unknown> {
    const userId = event.user?.id.number;
    const operatorId = event.operator?.id.number;
    const groupId = event.group?.id.number;
    const canonical = canonicalNotice(event, userId, operatorId, groupId);

    return {
        post_type: "notice",
        notice_type: canonical.noticeType,
        ...(userId !== undefined ? { user_id: userId } : {}),
        ...(operatorId !== undefined ? { operator_id: operatorId } : {}),
        ...(groupId !== undefined ? { group_id: groupId } : {}),
        ...(canonical.subType
            ? { sub_type: canonical.subType }
            : !canonical.ignoreSourceSubtype && event.sub_type
              ? { sub_type: event.sub_type }
              : {}),
        ...(event.message_id ? { message_id: event.message_id.number } : {}),
        ...(typeof event.duration === "number" ? { duration: event.duration } : {}),
        ...(idNumber(event.target_id) !== undefined
            ? { target_id: idNumber(event.target_id) }
            : {}),
        ...(event.resource
            ? {
                  resource_type: event.resource.type,
                  resource_id: event.resource.id.string,
                  resource_name: event.resource.name,
              }
            : {}),
        ...(event.extensions ? { extensions: event.extensions } : {}),
    };
}

interface CanonicalNotice {
    noticeType: string;
    subType?: string;
    ignoreSourceSubtype?: boolean;
}

function canonicalNotice(
    event: CommonEvent.Notice,
    userId: number | undefined,
    operatorId: number | undefined,
    groupId: number | undefined,
): CanonicalNotice {
    if (event.notice_type === "member_joined" || event.notice_type === "group_increase") {
        if (groupId === undefined || userId === undefined || operatorId === undefined) {
            return { noticeType: event.notice_type };
        }
        return {
            noticeType: "group_increase",
            subType: increaseSubtype(event.sub_type, userId, operatorId),
        };
    }
    if (event.notice_type === "member_left" || event.notice_type === "group_decrease") {
        if (groupId === undefined || userId === undefined || operatorId === undefined) {
            return { noticeType: event.notice_type };
        }
        return {
            noticeType: "group_decrease",
            subType: decreaseSubtype(event, userId, operatorId),
        };
    }
    if (event.notice_type === "message_deleted") {
        if (
            !event.message_id ||
            userId === undefined ||
            (groupId !== undefined && operatorId === undefined)
        ) {
            return { noticeType: event.notice_type };
        }
        return {
            noticeType: event.group ? "group_recall" : "friend_recall",
            ignoreSourceSubtype: true,
        };
    }
    if (event.notice_type === "friend_remove") {
        if (userId === undefined) return { noticeType: event.notice_type };
        return { noticeType: "friend_delete", ignoreSourceSubtype: true };
    }
    if (event.notice_type === "interaction" && event.sub_type === "poke") {
        return { noticeType: "notify", subType: "poke" };
    }
    return { noticeType: event.notice_type };
}

function increaseSubtype(
    subtype: unknown,
    userId: number | undefined,
    operatorId: number | undefined,
): "approve" | "invite" {
    if (subtype === "invite") return "invite";
    if (subtype === "approve") return "approve";
    return operatorId !== undefined && operatorId !== userId ? "invite" : "approve";
}

function decreaseSubtype(
    event: CommonEvent.Notice,
    userId: number | undefined,
    operatorId: number | undefined,
): "leave" | "kick" | "kick_me" {
    if (
        userId !== undefined &&
        userId === event.bot_id.number &&
        operatorId !== undefined &&
        operatorId !== userId
    ) {
        return "kick_me";
    }
    if (event.sub_type === "kick") return "kick";
    if (event.sub_type === "leave") return "leave";
    return operatorId === undefined || operatorId === userId ? "leave" : "kick";
}

function idNumber(value: unknown): number | undefined {
    if (typeof value === "number") return value;
    if (!value || typeof value !== "object" || !("number" in value)) return undefined;
    const number = value.number;
    return typeof number === "number" ? number : undefined;
}
