import {
    type Adapter,
    requireBooleanParam,
    requireNonEmptyStringParam,
    requirePositiveIntegerParam,
} from "onebots";
import { projectMilkySegments } from "./message-segments.js";

export const MILKY_GROUP_ACTIONS = new Set([
    "kick_group_member",
    "invite_friend_to_group",
    "set_group_member_mute",
    "set_group_member_admin",
    "set_group_member_card",
    "set_group_member_special_title",
    "set_group_name",
    "quit_group",
    "send_group_nudge",
    "set_group_avatar",
    "set_group_whole_mute",
    "send_group_announcement",
    "set_group_essence_message",
    "send_group_message_reaction",
    "get_group_announcements",
    "delete_group_announcement",
    "get_group_essence_messages",
]);

/** 将 Milky 群管理动作严格翻译到通用 Adapter seam。 */
export async function executeMilkyGroupAction(
    adapter: Adapter,
    accountId: string,
    action: string,
    params: Record<string, unknown>,
): Promise<unknown> {
    const groupId = adapter.resolveId(requirePositiveIntegerParam(params, "group_id"));

    switch (action) {
        case "kick_group_member":
            await adapter.kickGroupMember(accountId, {
                group_id: groupId,
                user_id: resolveUserId(adapter, params),
                reject_add_request: optionalBoolean(params, "reject_add_request", false),
            });
            break;
        case "invite_friend_to_group":
            await adapter.inviteGroupMember(accountId, {
                group_id: groupId,
                user_id: resolveUserId(adapter, params),
            });
            break;
        case "set_group_member_mute":
            await adapter.muteGroupMember(accountId, {
                group_id: groupId,
                user_id: resolveUserId(adapter, params),
                duration: nonNegativeInteger(params, "duration", 0),
            });
            break;
        case "set_group_member_admin":
            await adapter.setGroupAdmin(accountId, {
                group_id: groupId,
                user_id: resolveUserId(adapter, params),
                enable: optionalBoolean(params, "is_set", true),
            });
            break;
        case "set_group_member_card":
            await adapter.setGroupCard(accountId, {
                group_id: groupId,
                user_id: resolveUserId(adapter, params),
                card: stringParam(params, "card"),
            });
            break;
        case "set_group_member_special_title":
            await adapter.setGroupSpecialTitle(accountId, {
                group_id: groupId,
                user_id: resolveUserId(adapter, params),
                special_title: stringParam(params, "special_title"),
                duration: -1,
            });
            break;
        case "set_group_name":
            await adapter.setGroupName(accountId, {
                group_id: groupId,
                group_name: requireNonEmptyStringParam(params, "new_group_name"),
            });
            break;
        case "quit_group":
            await adapter.leaveGroup(accountId, { group_id: groupId });
            break;
        case "send_group_nudge":
            await adapter.sendGroupNudge(accountId, {
                group_id: groupId,
                user_id: resolveUserId(adapter, params),
            });
            break;
        case "set_group_avatar":
            await adapter.setGroupAvatar(accountId, {
                group_id: groupId,
                file: requireNonEmptyStringParam(params, "image_uri"),
            });
            break;
        case "set_group_whole_mute":
            await adapter.muteGroupAll(accountId, {
                group_id: groupId,
                enable: optionalBoolean(params, "is_mute", true),
            });
            break;
        case "send_group_announcement":
            if (params.image_uri !== undefined) {
                throw new TypeError("当前 Adapter 不支持带图片的群公告");
            }
            await adapter.sendGroupAnnouncement(accountId, {
                group_id: groupId,
                content: requireNonEmptyStringParam(params, "content"),
            });
            break;
        case "set_group_essence_message": {
            const essenceParams = {
                group_id: groupId,
                message_id: adapter.resolveId(requirePositiveIntegerParam(params, "message_seq")),
            };
            if (optionalBoolean(params, "is_set", true)) {
                await adapter.setGroupEssenceMessage(accountId, essenceParams);
            } else {
                await adapter.deleteGroupEssenceMessage(accountId, essenceParams);
            }
            break;
        }
        case "send_group_message_reaction":
            await adapter.sendGroupMessageReaction(accountId, {
                group_id: groupId,
                message_id: adapter.resolveId(requirePositiveIntegerParam(params, "message_seq")),
                reaction: requireNonEmptyStringParam(params, "reaction"),
                reaction_type: reactionType(params),
                is_add: optionalBoolean(params, "is_add", true),
            });
            break;
        case "get_group_announcements": {
            const announcements = await adapter.getGroupAnnouncements(accountId, {
                group_id: groupId,
            });
            return { announcements: announcements.map(projectGroupAnnouncement) };
        }
        case "delete_group_announcement":
            await adapter.deleteGroupAnnouncement(accountId, {
                group_id: groupId,
                announcement_id: adapter.resolveId(
                    requireNonEmptyStringParam(params, "announcement_id"),
                ),
            });
            break;
        case "get_group_essence_messages": {
            const pageIndex = nonNegativeInteger(params, "page_index", 0);
            const pageSize = positiveInteger(params, "page_size");
            const messages = await adapter.getGroupEssenceMessages(accountId, {
                group_id: groupId,
                page_index: pageIndex,
                page_size: pageSize,
            });
            return {
                messages: messages.map(projectGroupEssenceMessage),
                is_end: messages.length < pageSize,
            };
        }
        default:
            throw new TypeError(`未知 Milky 群动作: ${action}`);
    }

    return {};
}

function projectGroupAnnouncement(value: Adapter.GroupAnnouncement) {
    return {
        group_id: positiveId(value.group_id.number, "group_id"),
        announcement_id: value.announcement_id.string,
        user_id: positiveId(value.sender_id?.number, "user_id"),
        time: nonNegativeValue(value.time, "time"),
        content: value.content,
        ...(value.image_url === undefined ? {} : { image_url: value.image_url }),
    };
}

function projectGroupEssenceMessage(value: Adapter.GroupEssenceMessage) {
    return {
        group_id: positiveId(value.group_id.number, "group_id"),
        message_seq: positiveId(value.message_id.number, "message_seq"),
        message_time: nonNegativeValue(value.message_time, "message_time"),
        sender_id: positiveId(value.sender_id.number, "sender_id"),
        sender_name: value.sender_name,
        operator_id: positiveId(value.operator_id.number, "operator_id"),
        operator_name: value.operator_name,
        operation_time: nonNegativeValue(value.operation_time, "operation_time"),
        segments: projectMilkySegments(value.message),
    };
}

function resolveUserId(adapter: Adapter, params: Record<string, unknown>) {
    return adapter.resolveId(requirePositiveIntegerParam(params, "user_id"));
}

function optionalBoolean(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
    return params[key] === undefined ? fallback : requireBooleanParam(params, key);
}

function stringParam(params: Record<string, unknown>, key: string): string {
    const value = params[key];
    if (typeof value !== "string") throw new TypeError(`${key} 必须是字符串`);
    return value;
}

function nonNegativeInteger(
    params: Record<string, unknown>,
    key: string,
    fallback: number,
): number {
    const value = params[key] ?? fallback;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${key} 必须是非负整数`);
    }
    return value;
}

function positiveInteger(params: Record<string, unknown>, key: string): number {
    const value = params[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${key} 必须是正整数`);
    }
    return value;
}

function nonNegativeValue(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`Adapter 返回的 ${field} 必须是非负整数`);
    }
    return value;
}

function positiveId(value: unknown, field: string): number {
    const id = nonNegativeValue(value, field);
    if (id === 0) throw new TypeError(`Adapter 返回的 ${field} 必须是正整数 ID`);
    return id;
}

function reactionType(params: Record<string, unknown>): "face" | "emoji" {
    const value = params.reaction_type ?? "face";
    if (value !== "face" && value !== "emoji") {
        throw new TypeError("reaction_type 必须是 face 或 emoji");
    }
    return value;
}
