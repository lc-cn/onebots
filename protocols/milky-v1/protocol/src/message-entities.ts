import type { Adapter } from "onebots";
import { projectMilkyFriend } from "./friend-entities.js";
import { projectMilkyGroup, projectMilkyGroupMember } from "./group-entities.js";
import { projectMilkySegments } from "./message-segments.js";
import type { Milky } from "./types.js";

/** 补齐消息所属实体并投影 canonical IncomingMessage。 */
export async function projectMilkyIncomingMessage(
    adapter: Adapter,
    accountId: string,
    message: Adapter.MessageInfo,
): Promise<Milky.MessageInfo> {
    const base = {
        peer_id: positiveId(message.sender.scene_id.number, "peer_id"),
        message_seq: positiveId(message.message_id.number, "message_seq"),
        sender_id: positiveId(message.sender.sender_id.number, "sender_id"),
        time: nonNegativeInteger(message.time, "time"),
        segments: projectMilkySegments(message.message),
    };

    if (message.sender.scene_type === "private") {
        const friend = await adapter.getFriendInfo(accountId, {
            user_id: message.sender.scene_id,
        });
        return { ...base, message_scene: "friend", friend: projectMilkyFriend(friend) };
    }
    if (message.sender.scene_type === "group") {
        const [group, member] = await Promise.all([
            adapter.getGroupInfo(accountId, { group_id: message.sender.scene_id }),
            adapter.getGroupMemberInfo(accountId, {
                group_id: message.sender.scene_id,
                user_id: message.sender.sender_id,
            }),
        ]);
        return {
            ...base,
            message_scene: "group",
            group: projectMilkyGroup(group),
            group_member: projectMilkyGroupMember(member),
        };
    }
    throw new TypeError(`Milky 不支持 ${message.sender.scene_type} 消息场景`);
}

function nonNegativeInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`Adapter 返回的 ${field} 必须是非负整数`);
    }
    return value;
}

function positiveId(value: unknown, field: string): number {
    const id = nonNegativeInteger(value, field);
    if (id === 0) throw new TypeError(`Adapter 返回的 ${field} 必须是正整数 ID`);
    return id;
}
