import type { DingTalkBot } from "./bot.js";
import type {
    DingTalkDepartmentListResponse,
    DingTalkDepartmentUserResponse,
    DingTalkSceneGroupMember,
    DingTalkSceneGroupMemberResponse,
    DingTalkUser,
} from "./types.js";

/** 分页读取指定部门的直属用户。 */
export async function getDingTalkDepartmentUsers(
    bot: DingTalkBot,
    departmentId: number,
): Promise<DingTalkUser[]> {
    const users: DingTalkUser[] = [];
    let cursor = 0;
    do {
        const response = await bot.callApi<DingTalkDepartmentUserResponse>("/topapi/v2/user/list", {
            method: "POST",
            body: { dept_id: departmentId, cursor, size: 100 },
        });
        users.push(...(response.result?.list || []));
        cursor = response.result?.has_more ? response.result.next_cursor || 0 : 0;
    } while (cursor);
    return users;
}

/** 遍历应用可见的部门树，并按用户 ID 去重。 */
export async function getDingTalkVisibleUsers(
    bot: DingTalkBot,
    rootDepartmentId: number,
): Promise<DingTalkUser[]> {
    const users = new Map<string, DingTalkUser>();
    const pendingDepartments = [rootDepartmentId];
    const visitedDepartments = new Set<number>();
    while (pendingDepartments.length) {
        const departmentId = pendingDepartments.shift();
        if (departmentId == null || visitedDepartments.has(departmentId)) continue;
        visitedDepartments.add(departmentId);
        const [departmentUsers, childIds] = await Promise.all([
            getDingTalkDepartmentUsers(bot, departmentId),
            getSubDepartmentIds(bot, departmentId),
        ]);
        for (const user of departmentUsers) users.set(user.userid, user);
        pendingDepartments.push(...childIds);
    }
    return [...users.values()];
}

/** 分页读取场景群成员，并保留群昵称。 */
export async function getDingTalkSceneGroupMembers(
    bot: DingTalkBot,
    openConversationId: string,
): Promise<DingTalkSceneGroupMember[]> {
    const members = new Map<string, DingTalkSceneGroupMember>();
    let cursor = "0";
    do {
        const response = await bot.callApi<DingTalkSceneGroupMemberResponse>(
            "/topapi/im/chat/scenegroup/member/get",
            {
                method: "POST",
                auth: "legacy",
                body: { open_conversation_id: openConversationId, cursor, size: 100 },
            },
        );
        const result = response.result;
        const nicknames = parseNicknameMap(result?.staff_id_nick_map);
        for (const userId of result?.member_user_ids || []) {
            members.set(userId, { userId, nickname: nicknames[userId] });
        }
        cursor = result?.has_more ? result.next_cursor || "" : "";
    } while (cursor);
    return [...members.values()];
}

async function getSubDepartmentIds(bot: DingTalkBot, departmentId: number): Promise<number[]> {
    const response = await bot.callApi<DingTalkDepartmentListResponse>(
        "/topapi/v2/department/listsub",
        { method: "POST", body: { dept_id: departmentId } },
    );
    return (response.result || []).map(department => department.dept_id);
}

function parseNicknameMap(
    value: Record<string, string> | string | undefined,
): Record<string, string> {
    if (!value) return {};
    if (typeof value === "object") return value;
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, string>)
            : {};
    } catch {
        return {};
    }
}
