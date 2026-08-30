import { QQApiError } from "./errors.js";
import type { QQClient } from "./client.js";
import type { QQUser } from "./types.js";

export interface QQGuild {
    id: string;
    name: string;
}

export interface QQChannel {
    id: string;
    name: string;
    type?: number;
    parent_id?: string;
}

export interface QQGuildMember {
    user: QQUser;
    nick?: string;
    roles?: string[];
}

export interface QQGroup {
    group_openid: string;
    group_name?: string;
    group_member_num?: number;
}

export interface QQGuildMessage {
    id: string;
    timestamp?: string;
    content?: string;
    author?: QQUser;
    attachments?: Array<{ url: string; content_type?: string; filename?: string }>;
}

/** QQ 频道与群管理 OpenAPI 的强类型路径封装。 */
export class QQOpenApi {
    constructor(private readonly client: QQClient) {}

    getSelf(): Promise<QQUser> {
        return this.client.fetchSelf();
    }

    async listGuilds(): Promise<QQGuild[]> {
        const result: QQGuild[] = [];
        let after: string | undefined;
        const cursors = new Set<string>();
        do {
            const page = await this.client.call<QQGuild[]>({
                method: "GET",
                path: "/users/@me/guilds",
                query: { limit: 100, ...(after ? { after } : {}) },
            });
            result.push(...page);
            after = page.length === 100 ? page.at(-1)?.id : undefined;
            if (page.length === 100 && !after) {
                throw invalidPage("QQ Guild 列表满页响应缺少末项 ID", "/users/@me/guilds");
            }
            if (after && cursors.has(after)) {
                throw stalledPage("QQ Guild 列表分页游标未推进", "/users/@me/guilds", after);
            }
            if (after) cursors.add(after);
        } while (after);
        return result;
    }

    getGuild(guildId: string): Promise<QQGuild> {
        return this.client.call({ method: "GET", path: `/guilds/${guildId}` });
    }

    listChannels(guildId: string): Promise<QQChannel[]> {
        return this.client.call({ method: "GET", path: `/guilds/${guildId}/channels` });
    }

    getChannel(channelId: string): Promise<QQChannel> {
        return this.client.call({ method: "GET", path: `/channels/${channelId}` });
    }

    createChannel(guildId: string, body: Record<string, unknown>): Promise<QQChannel> {
        return this.client.call({ method: "POST", path: `/guilds/${guildId}/channels`, body });
    }

    updateChannel(channelId: string, body: Record<string, unknown>): Promise<QQChannel> {
        return this.client.call({ method: "PATCH", path: `/channels/${channelId}`, body });
    }

    async deleteChannel(channelId: string): Promise<void> {
        await this.client.call({ method: "DELETE", path: `/channels/${channelId}` });
    }

    getMember(guildId: string, userId: string): Promise<QQGuildMember> {
        return this.client.call({ method: "GET", path: `/guilds/${guildId}/members/${userId}` });
    }

    async listMembers(guildId: string): Promise<QQGuildMember[]> {
        const result: QQGuildMember[] = [];
        let after: string | undefined;
        const cursors = new Set<string>();
        do {
            const page = await this.client.call<QQGuildMember[]>({
                method: "GET",
                path: `/guilds/${guildId}/members`,
                query: { limit: 400, ...(after ? { after } : {}) },
            });
            result.push(...page);
            after = page.length === 400 ? page.at(-1)?.user.id : undefined;
            if (page.length === 400 && !after) {
                throw invalidPage(
                    "QQ Guild 成员列表满页响应缺少末项用户 ID",
                    `/guilds/${guildId}/members`,
                );
            }
            if (after && cursors.has(after)) {
                throw stalledPage(
                    "QQ Guild 成员列表分页游标未推进",
                    `/guilds/${guildId}/members`,
                    after,
                );
            }
            if (after) cursors.add(after);
        } while (after);
        return result;
    }

    async kickMember(guildId: string, userId: string, addBlacklist = false): Promise<void> {
        await this.client.call({
            method: "DELETE",
            path: `/guilds/${guildId}/members/${userId}`,
            query: { add_blacklist: addBlacklist },
        });
    }

    async muteMember(guildId: string, userId: string, seconds: number): Promise<void> {
        await this.client.call({
            method: "PUT",
            path: `/guilds/${guildId}/members/${userId}/mute`,
            body: { mute_seconds: String(seconds) },
        });
    }

    async muteGuild(guildId: string, seconds: number): Promise<void> {
        await this.client.call({
            method: "PUT",
            path: `/guilds/${guildId}/mute`,
            body: { mute_seconds: String(seconds) },
        });
    }

    getGroup(groupId: string): Promise<QQGroup> {
        return this.client.call({ method: "GET", path: `/v2/groups/${groupId}/info` });
    }

    getMessage(
        scene: "channel" | "direct",
        sceneId: string,
        messageId: string,
    ): Promise<QQGuildMessage> {
        const path =
            scene === "channel"
                ? `/channels/${sceneId}/messages/${messageId}`
                : `/dms/${sceneId}/messages/${messageId}`;
        return this.client.call({ method: "GET", path });
    }

    async recallMessage(
        scene: "private" | "group" | "channel" | "direct",
        sceneId: string,
        messageId: string,
    ): Promise<void> {
        const path =
            scene === "private"
                ? `/v2/users/${sceneId}/messages/${messageId}`
                : scene === "group"
                  ? `/v2/groups/${sceneId}/messages/${messageId}`
                  : scene === "channel"
                    ? `/channels/${sceneId}/messages/${messageId}`
                    : `/dms/${sceneId}/messages/${messageId}`;
        await this.client.call({ method: "DELETE", path });
    }

    createDirectSession(guildId: string, userId: string): Promise<{ guild_id: string }> {
        return this.client.call({
            method: "POST",
            path: "/users/@me/dms",
            body: { source_guild_id: guildId, recipient_id: userId },
        });
    }
}

function invalidPage(message: string, path: string): QQApiError {
    return new QQApiError(message, { code: "QQ_INVALID_PAGE_RESPONSE", path });
}

function stalledPage(message: string, path: string, cursor: string): QQApiError {
    return new QQApiError(message, {
        code: "QQ_PAGINATION_STALLED",
        path,
        details: { cursor },
    });
}
