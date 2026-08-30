import { FeishuError } from "./errors.js";
import { collectFeishuPages } from "./pagination.js";
import type {
    FeishuApiEnvelope,
    FeishuAPIResponse,
    FeishuChat,
    FeishuChatAPIResponse,
    FeishuChatMembersAPIResponse,
    FeishuSendMessageRequest,
    FeishuSendMessageResponse,
    FeishuReceiveIdType,
    FeishuUser,
    FeishuUserAPIResponse,
} from "./types.js";

export interface FeishuResourceClient {
    get<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        params?: Record<string, string | number | boolean>,
    ): Promise<{ data: T }>;
    post<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        body?: string | Record<string, unknown>,
        params?: Record<string, string | number | boolean>,
    ): Promise<{ data: T }>;
}

export async function fetchFeishuBotInfo(client: FeishuResourceClient): Promise<FeishuUser> {
    const { data } = await client.get<
        FeishuAPIResponse & {
            bot?: { open_id?: string; app_name?: string; avatar_url?: string };
        }
    >("/bot/v3/info");
    if (!data.bot?.open_id)
        throw missing("FEISHU_BOT_INFO_MISSING", "获取 Bot 信息失败: 响应缺少 bot.open_id", data);
    return {
        user_id: data.bot.open_id,
        open_id: data.bot.open_id,
        name: data.bot.app_name || "Feishu Bot",
        avatar_url: data.bot.avatar_url,
    };
}

export async function sendFeishuMessage(
    client: FeishuResourceClient,
    receiveId: string,
    receiveIdType: FeishuReceiveIdType,
    content: string | Record<string, unknown>,
    msgType: FeishuSendMessageRequest["msg_type"],
): Promise<FeishuSendMessageResponse> {
    const request: FeishuSendMessageRequest = {
        receive_id: receiveId,
        msg_type: msgType,
        content: JSON.stringify(typeof content === "string" ? { text: content } : content),
    };
    const { data } = await client.post<FeishuSendMessageResponse>(
        "/im/v1/messages",
        request as unknown as Record<string, unknown>,
        { receive_id_type: receiveIdType },
    );
    return data;
}

export async function fetchFeishuUser(
    client: FeishuResourceClient,
    userId: string,
    userIdType: "open_id" | "user_id" | "union_id" = "open_id",
): Promise<FeishuUser> {
    const { data } = await client.get<FeishuUserAPIResponse>(
        `/contact/v3/users/${encodeURIComponent(userId)}`,
        { user_id_type: userIdType },
    );
    if (!data.data?.user)
        throw missing("FEISHU_USER_MISSING", "获取用户信息失败: 响应缺少 user", data);
    return data.data.user;
}

export async function fetchFeishuChat(
    client: FeishuResourceClient,
    chatId: string,
): Promise<FeishuChat> {
    const { data } = await client.get<FeishuChatAPIResponse>(
        `/im/v1/chats/${encodeURIComponent(chatId)}`,
    );
    if (!data.data) throw missing("FEISHU_CHAT_MISSING", "获取群组信息失败: 响应缺少 chat", data);
    return data.data;
}

export async function fetchFeishuChats(client: FeishuResourceClient): Promise<FeishuChat[]> {
    return fetchPages<FeishuChat>(client, "/im/v1/chats", { page_size: 100 });
}

export async function fetchFeishuUsers(client: FeishuResourceClient): Promise<FeishuUser[]> {
    return fetchPages<FeishuUser>(client, "/contact/v3/users/find_by_department", {
        department_id: "0",
        user_id_type: "open_id",
        department_id_type: "department_id",
        page_size: 50,
    });
}

export async function fetchFeishuChatMembers(
    client: FeishuResourceClient,
    chatId: string,
): Promise<FeishuUser[]> {
    return collectFeishuPages("获取群成员列表", async pageToken => {
        const { data } = await client.get<FeishuChatMembersAPIResponse>(
            `/im/v1/chats/${encodeURIComponent(chatId)}/members`,
            { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
        );
        if (!data.data)
            throw missing(
                "FEISHU_CHAT_MEMBERS_MISSING",
                "获取群组成员列表失败: 响应缺少 data",
                data,
            );
        return data.data;
    });
}

/** 在真实群成员目录中查找用户，避免把全局通讯录用户误报为群成员。 */
export async function fetchFeishuChatMember(
    client: FeishuResourceClient,
    chatId: string,
    userId: string,
): Promise<FeishuUser> {
    const member = (await fetchFeishuChatMembers(client, chatId)).find(user =>
        [user.open_id, user.user_id, user.union_id].includes(userId),
    );
    if (!member) {
        throw new FeishuError(`飞书用户 ${userId} 不是群 ${chatId} 的成员`, {
            code: "FEISHU_GROUP_MEMBER_NOT_FOUND",
            details: { group_id: chatId, user_id: userId },
        });
    }
    return member;
}

async function fetchPages<T>(
    client: FeishuResourceClient,
    path: string,
    params: Record<string, string | number | boolean>,
): Promise<T[]> {
    return collectFeishuPages(path, async pageToken => {
        const { data } = await client.get<
            FeishuAPIResponse & {
                data?: { items?: T[]; page_token?: string; has_more?: boolean };
            }
        >(path, { ...params, ...(pageToken ? { page_token: pageToken } : {}) });
        if (!data.data) throw missing("FEISHU_PAGE_MISSING", `${path} 响应缺少 data`, data);
        return data.data;
    });
}

function missing(code: string, message: string, details: unknown): FeishuError {
    return new FeishuError(message, { code, details });
}
