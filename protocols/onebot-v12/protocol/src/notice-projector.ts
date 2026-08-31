import type { CommonEvent } from "onebots";

/** 将 CommonEvent 通知投影为 OneBot V12 标准通知；无标准表示时使用带平台前缀的扩展类型。 */
export function projectOneBotV12Notice(event: CommonEvent.Notice): Record<string, unknown> {
    const detailType = canonicalDetailType(event);
    const userId = event.user?.id.string;
    const operatorId = event.operator?.id.string;
    const groupId = event.group?.id.string;
    const channelId = event.group?.channel_id?.string ?? event.resource?.id.string;
    const guildId = event.group?.guild_id?.string;

    return {
        type: "notice",
        detail_type: detailType,
        sub_type: canonicalSubtype(event, detailType, userId, operatorId),
        ...(userId ? { user_id: userId } : {}),
        ...(operatorId ? { operator_id: operatorId } : {}),
        ...(groupId && !isChannelDetail(detailType) ? { group_id: groupId } : {}),
        ...(guildId ? { guild_id: guildId } : {}),
        ...(channelId && isChannelDetail(detailType) ? { channel_id: channelId } : {}),
        ...(event.message_id ? { message_id: event.message_id.string } : {}),
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

function canonicalDetailType(event: CommonEvent.Notice): string {
    const extension = `${event.platform}.${event.notice_type}`;
    switch (event.notice_type as string) {
        case "member_joined":
        case "group_increase":
        case "group_member_increase":
            return hasGroupMemberFields(event) ? "group_member_increase" : extension;
        case "member_left":
        case "group_decrease":
        case "group_member_decrease":
            return hasGroupMemberFields(event) ? "group_member_decrease" : extension;
        case "message_deleted":
            if (!event.message_id || !event.user) return extension;
            if (event.group?.channel_id || event.group?.guild_id) {
                return event.operator ? "channel_message_delete" : extension;
            }
            if (event.group) return event.operator ? "group_message_delete" : extension;
            return "private_message_delete";
        case "friend_add":
            return event.user ? "friend_increase" : extension;
        case "friend_remove":
            return event.user ? "friend_decrease" : extension;
        case "channel_created":
            return hasChannelFields(event) ? "channel_create" : extension;
        case "channel_deleted":
            return hasChannelFields(event) ? "channel_delete" : extension;
        default:
            return extension;
    }
}

function hasGroupMemberFields(event: CommonEvent.Notice): boolean {
    return Boolean(event.group && event.user && event.operator);
}

function hasChannelFields(event: CommonEvent.Notice): boolean {
    return Boolean(
        event.resource?.type === "channel" &&
        event.operator &&
        event.group?.guild_id &&
        (event.group.channel_id || event.resource.id),
    );
}

function canonicalSubtype(
    event: CommonEvent.Notice,
    detailType: string,
    userId: string | undefined,
    operatorId: string | undefined,
): string {
    if (detailType.endsWith("member_increase")) {
        if (event.sub_type === "invite") return "invite";
        return operatorId && userId && operatorId !== userId ? "invite" : "join";
    }
    if (detailType.endsWith("member_decrease")) {
        if (event.sub_type === "kick" || event.sub_type === "kick_me") return "kick";
        return operatorId && userId && operatorId !== userId ? "kick" : "leave";
    }
    if (detailType.endsWith("message_delete")) {
        if (detailType === "private_message_delete") return "";
        return operatorId && userId && operatorId !== userId ? "delete" : "recall";
    }
    return typeof event.sub_type === "string" ? event.sub_type : "";
}

function isChannelDetail(detailType: string): boolean {
    return detailType.startsWith("channel_");
}
