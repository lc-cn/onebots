import type { Adapter, CommonTypes } from "onebots";
import { GoogleChatError } from "./errors.js";
import { projectGoogleChatMessage } from "./messages.js";
import type { GoogleChatClient } from "./client.js";
import type {
    GoogleChatMembership,
    GoogleChatMessage,
    GoogleChatSpace,
    GoogleChatUser,
} from "./types.js";

type CreateId = (value: string | number) => CommonTypes.Id;

export function requireSpaceName(value: string): string {
    if (!/^spaces\/[^/]+$/u.test(value)) throw GoogleChatError.invalid("Space resource name 无效");
    return value;
}

export function requireMessageName(value: string): string {
    if (!/^spaces\/[^/]+\/messages\/[^/]+$/u.test(value)) {
        throw GoogleChatError.invalid("Message resource name 无效");
    }
    return value;
}

export function requireUserName(value: string): string {
    if (!/^users\/(?:app|me|[^/]+)$/u.test(value)) {
        throw GoogleChatError.invalid("User resource name 无效");
    }
    return value;
}

export function isDirectSpace(space: GoogleChatSpace): boolean {
    return (
        space.spaceType === "DIRECT_MESSAGE" ||
        space.type === "DM" ||
        space.singleUserBotDm === true
    );
}

export function googleChatGroup(createId: CreateId, space: GoogleChatSpace): Adapter.GroupInfo {
    const directHumans = space.membershipCount?.joinedDirectHumanUserCount || 0;
    const groups = space.membershipCount?.joinedGroupCount || 0;
    const memberCount = directHumans + groups;
    return {
        group_id: createId(space.name),
        group_name: space.displayName || space.name,
        member_count: memberCount || undefined,
    };
}

export function googleChatMember(
    createId: CreateId,
    membership: GoogleChatMembership,
): Adapter.GroupMemberInfo {
    if (!membership.member) throw GoogleChatError.invalid("membership 缺少 member");
    return {
        group_id: createId(membership.name.split("/members/")[0]),
        user_id: createId(membership.member.name),
        user_name: membership.member.displayName || membership.member.name,
        card: membership.member.displayName,
        role:
            membership.role === "ROLE_MANAGER" || membership.role === "ROLE_ASSISTANT_MANAGER"
                ? "admin"
                : "member",
        join_time: membership.createTime
            ? Math.floor(Date.parse(membership.createTime) / 1000)
            : undefined,
    };
}

export function googleChatUser(
    createId: CreateId,
    name: string,
    user?: GoogleChatUser,
    fallback?: string,
): Adapter.UserInfo {
    return {
        user_id: createId(name),
        user_name: user?.displayName || fallback || name,
        user_displayname: user?.displayName,
        avatar: user?.avatarUrl,
    };
}

export function googleChatMessage(
    createId: CreateId,
    client: GoogleChatClient,
    message: GoogleChatMessage,
): Adapter.MessageInfo {
    const spaceName = message.name.split("/messages/")[0];
    const space = message.space || client.getCachedSpace(spaceName) || { name: spaceName };
    const sender = message.sender;
    return {
        message_id: createId(message.name),
        time: message.createTime ? Math.floor(Date.parse(message.createTime) / 1000) : 0,
        sender: {
            scene_type: isDirectSpace(space) ? "direct" : "group",
            sender_id: createId(sender?.name || "users/unknown"),
            scene_id: createId(spaceName),
            sender_name: sender?.displayName || sender?.name || "Google Chat user",
            scene_name: space.displayName || spaceName,
        },
        message: projectGoogleChatMessage(message),
    };
}

export async function paginateGoogleChat<T>(
    load: (pageToken?: string) => Promise<unknown>,
    parse: (value: unknown) => { items: T[]; nextPageToken?: string },
): Promise<T[]> {
    const items: T[] = [];
    let token: string | undefined;
    for (let page = 0; page < 1000; page += 1) {
        const result = parse(await load(token));
        items.push(...result.items);
        if (!result.nextPageToken) return items;
        if (result.nextPageToken === token) {
            throw GoogleChatError.invalid("Google Chat 分页 token 未推进");
        }
        token = result.nextPageToken;
    }
    throw GoogleChatError.invalid("Google Chat 分页超过 1000 页安全限制");
}
