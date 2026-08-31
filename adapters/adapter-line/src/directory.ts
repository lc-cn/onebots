import type { LineBotClient, messagingApi } from "@line/bot-sdk";
import { mapConcurrent } from "onebots";
import { LineApiError } from "./errors.js";

export interface LineChatAddress {
    id: string;
    type: "group" | "room";
}

const PROFILE_CONCURRENCY = 10;

/** 完整读取关注者目录，去重并拒绝平台返回停滞游标。 */
export async function listLineFollowerIds(client: LineBotClient): Promise<string[]> {
    const ids = new Set<string>();
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    do {
        const page = await client.getFollowers(cursor, 1_000);
        for (const id of page.userIds) ids.add(id);
        cursor = nextCursor(page.next, seenCursors, "关注者");
    } while (cursor);
    return [...ids];
}

/** 完整读取群或房间成员，并以受控并发补全成员资料。 */
export async function listLineMemberProfiles(
    client: LineBotClient,
    chat: LineChatAddress,
): Promise<Array<messagingApi.GroupUserProfileResponse | messagingApi.RoomUserProfileResponse>> {
    const ids = new Set<string>();
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    do {
        const page =
            chat.type === "room"
                ? await client.getRoomMembersIds(chat.id, cursor)
                : await client.getGroupMembersIds(chat.id, cursor);
        for (const id of page.memberIds) ids.add(id);
        cursor = nextCursor(page.next, seenCursors, "成员");
    } while (cursor);
    return mapConcurrent([...ids], PROFILE_CONCURRENCY, userId =>
        chat.type === "room"
            ? client.getRoomMemberProfile(chat.id, userId)
            : client.getGroupMemberProfile(chat.id, userId),
    );
}

function nextCursor(
    value: string | undefined,
    seen: Set<string>,
    directoryName: string,
): string | undefined {
    if (!value) return undefined;
    if (seen.has(value)) {
        throw new LineApiError(`LINE ${directoryName}分页游标没有推进`, {
            code: "LINE_CURSOR_STALLED",
            details: value,
        });
    }
    seen.add(value);
    return value;
}
