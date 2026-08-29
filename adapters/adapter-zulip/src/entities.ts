import { type Adapter, type CommonTypes } from "onebots";
import { projectZulipMessage } from "./events.js";
import { directRecipients, directScene } from "./scenes.js";
import type { ZulipMessage, ZulipStream, ZulipUser } from "./types.js";

type CreateId = (value: string | number) => CommonTypes.Id;

/** 将组织成员映射为通用用户资料。 */
export function toUserInfo(user: ZulipUser, createId: CreateId): Adapter.UserInfo {
    return {
        user_id: createId(user.user_id),
        user_name: user.email,
        user_displayname: user.full_name,
        avatar: user.avatar_url || undefined,
    };
}

/** 将频道映射为通用群组资料。 */
export function toGroupInfo(stream: ZulipStream, createId: CreateId): Adapter.GroupInfo {
    return { group_id: createId(stream.stream_id), group_name: stream.name };
}

/** 将频道订阅者映射为通用成员资料。 */
export function toGroupMember(
    groupId: CommonTypes.Id,
    user: ZulipUser,
    createId: CreateId,
): Adapter.GroupMemberInfo {
    return {
        group_id: groupId,
        user_id: createId(user.user_id),
        user_name: user.email,
        card: user.full_name,
        role: user.is_owner ? "owner" : user.is_admin ? "admin" : "member",
    };
}

/** 将频道、单人私聊或多人私聊消息映射为通用消息资料。 */
export function toMessageInfo(
    message: ZulipMessage,
    createId: CreateId,
    rawContent = message.content,
    serverUrl?: string,
    botEmail?: string,
): Adapter.MessageInfo {
    const stream = ["stream", "channel"].includes(message.type || message.message_type || "");
    const recipients = directRecipients(message, botEmail);
    const sceneId = stream
        ? `${message.stream_id}/${message.subject || ""}`
        : directScene(message, botEmail);
    return {
        message_id: createId(message.id),
        time: message.timestamp,
        sender: {
            scene_type: stream ? "group" : recipients.length > 1 ? "direct" : "private",
            sender_id: createId(message.sender_id),
            scene_id: createId(sceneId),
            sender_name: message.sender_full_name,
            scene_name:
                stream && typeof message.display_recipient === "string"
                    ? message.display_recipient
                    : recipients.map(recipient => recipient.full_name).join(", "),
        },
        message: projectZulipMessage({ ...message, content: rawContent }, serverUrl),
    };
}
