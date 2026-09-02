import { EventEmitter } from "node:events";
import { MattermostError } from "./errors.js";
import { FetchMattermostRestTransport, type MattermostRestTransport } from "./rest.js";
import type {
    MattermostCallOptions,
    MattermostChannel,
    MattermostChannelMember,
    MattermostClientEvents,
    MattermostConfig,
    MattermostCreatePost,
    MattermostFileInfo,
    MattermostHttpMethod,
    MattermostPost,
    MattermostPostList,
    MattermostReaction,
    MattermostStatus,
    MattermostTeam,
    MattermostTeamMember,
    MattermostUploadResult,
    MattermostUser,
} from "./types.js";
import {
    parseMattermostChannel,
    parseMattermostChannelMember,
    parseMattermostFileInfo,
    parseMattermostPost,
    parseMattermostPostList,
    parseMattermostReaction,
    parseMattermostStatus,
    parseMattermostTeam,
    parseMattermostTeamMember,
    parseMattermostUploadResult,
    parseMattermostUser,
} from "./validation.js";

export interface MattermostApiDependencies {
    fetcher?: typeof fetch;
    rest?: MattermostRestTransport;
}

/**
 * Mattermost REST v4 资源域。
 *
 * 这里集中处理 ID、分页、响应校验与当前身份，事件 Client 不需要知道具体路由。
 */
export class MattermostApiClient extends EventEmitter<MattermostClientEvents> {
    private readonly rest: MattermostRestTransport;
    private readonly channels = new Map<string, MattermostChannel>();
    private currentUser?: MattermostUser;

    constructor(
        readonly config: MattermostConfig,
        dependencies: MattermostApiDependencies = {},
    ) {
        super();
        this.rest =
            dependencies.rest || new FetchMattermostRestTransport(config, dependencies.fetcher);
    }

    get me(): MattermostUser | undefined {
        return this.currentUser ? structuredClone(this.currentUser) : undefined;
    }

    call(
        method: MattermostHttpMethod,
        path: string,
        options: MattermostCallOptions = {},
    ): Promise<unknown> {
        return this.rest.call(method, path, options);
    }

    async getMe(signal?: AbortSignal): Promise<MattermostUser> {
        return parseMattermostUser(await this.call("GET", "users/me", { signal }));
    }

    async getUser(userId: string): Promise<MattermostUser> {
        return parseMattermostUser(await this.call("GET", `users/${encodeId(userId)}`));
    }

    async listUsers(page = 0, perPage = 60): Promise<MattermostUser[]> {
        return parseArray(
            await this.call("GET", "users", {
                query: { page: pageNumber(page), per_page: pageSize(perPage) },
            }),
            "users",
            parseMattermostUser,
        );
    }

    listUsersInTeam(teamId: string, page = 0, perPage = 200): Promise<MattermostUser[]> {
        return this.listUsersByScope({ in_team: encodeId(teamId), page, per_page: perPage });
    }

    listUsersInChannel(channelId: string, page = 0, perPage = 200): Promise<MattermostUser[]> {
        return this.listUsersByScope({ in_channel: encodeId(channelId), page, per_page: perPage });
    }

    private async listUsersByScope(scope: {
        in_team?: string;
        in_channel?: string;
        page: number;
        per_page: number;
    }): Promise<MattermostUser[]> {
        return parseArray(
            await this.call("GET", "users", {
                query: {
                    ...scope,
                    page: pageNumber(scope.page),
                    per_page: pageSize(scope.per_page),
                },
            }),
            "scoped users",
            parseMattermostUser,
        );
    }

    async searchUsers(term: string, teamId?: string): Promise<MattermostUser[]> {
        return parseArray(
            await this.call("POST", "users/search", {
                body: { term: requiredText(term, "term"), team_id: teamId },
            }),
            "user search",
            parseMattermostUser,
        );
    }

    async listTeams(): Promise<MattermostTeam[]> {
        return parseArray(
            await this.call("GET", `users/${encodeId(this.requireUserId())}/teams`),
            "teams",
            parseMattermostTeam,
        );
    }

    async getTeam(teamId: string): Promise<MattermostTeam> {
        return parseMattermostTeam(await this.call("GET", `teams/${encodeId(teamId)}`));
    }

    async getTeamMember(teamId: string, userId: string): Promise<MattermostTeamMember> {
        return parseMattermostTeamMember(
            await this.call("GET", `teams/${encodeId(teamId)}/members/${encodeId(userId)}`),
        );
    }

    async listTeamMembers(
        teamId: string,
        page = 0,
        perPage = 200,
    ): Promise<MattermostTeamMember[]> {
        return parseArray(
            await this.call("GET", `teams/${encodeId(teamId)}/members`, {
                query: { page: pageNumber(page), per_page: pageSize(perPage) },
            }),
            "team members",
            parseMattermostTeamMember,
        );
    }

    /** REST v4 单页最多 200 条；完整遍历，避免大型 team 被静默截断。 */
    listAllTeamMembers(teamId: string): Promise<MattermostTeamMember[]> {
        return collectPages(page => this.listTeamMembers(teamId, page, 200));
    }

    async listChannels(teamId: string): Promise<MattermostChannel[]> {
        const channels = parseArray(
            await this.call(
                "GET",
                `users/${encodeId(this.requireUserId())}/teams/${encodeId(teamId)}/channels`,
            ),
            "channels",
            parseMattermostChannel,
        );
        channels.forEach(channel => this.channels.set(channel.id, channel));
        return channels;
    }

    async getChannel(channelId: string): Promise<MattermostChannel> {
        const channel = parseMattermostChannel(
            await this.call("GET", `channels/${encodeId(channelId)}`),
        );
        this.channels.set(channel.id, channel);
        return channel;
    }

    async getChannelMember(channelId: string, userId: string): Promise<MattermostChannelMember> {
        return parseMattermostChannelMember(
            await this.call("GET", `channels/${encodeId(channelId)}/members/${encodeId(userId)}`),
        );
    }

    async listChannelMembers(
        channelId: string,
        page = 0,
        perPage = 200,
    ): Promise<MattermostChannelMember[]> {
        return parseArray(
            await this.call("GET", `channels/${encodeId(channelId)}/members`, {
                query: { page: pageNumber(page), per_page: pageSize(perPage) },
            }),
            "channel members",
            parseMattermostChannelMember,
        );
    }

    /** 完整遍历 channel member 分页。 */
    listAllChannelMembers(channelId: string): Promise<MattermostChannelMember[]> {
        return collectPages(page => this.listChannelMembers(channelId, page, 200));
    }

    async getUsersByIds(userIds: readonly string[]): Promise<MattermostUser[]> {
        const unique = [...new Set(userIds.map(encodeId))];
        const users: MattermostUser[] = [];
        for (let offset = 0; offset < unique.length; offset += 200) {
            users.push(
                ...parseArray(
                    await this.call("POST", "users/ids", {
                        body: unique.slice(offset, offset + 200),
                    }),
                    "users by ids",
                    parseMattermostUser,
                ),
            );
        }
        return users;
    }

    getCachedChannel(channelId: string): MattermostChannel | undefined {
        const channel = this.channels.get(channelId);
        return channel ? structuredClone(channel) : undefined;
    }

    async createDirectChannel(userId: string): Promise<MattermostChannel> {
        return this.rememberChannel(
            parseMattermostChannel(
                await this.call("POST", "channels/direct", {
                    body: [this.requireUserId(), encodeId(userId)],
                }),
            ),
        );
    }

    async createGroupChannel(userIds: readonly string[]): Promise<MattermostChannel> {
        const unique = [...new Set([this.requireUserId(), ...userIds.map(encodeId)])];
        if (unique.length < 3 || unique.length > 8) {
            throw MattermostError.invalid("Mattermost group channel 必须包含 3 到 8 个不同用户");
        }
        return this.rememberChannel(
            parseMattermostChannel(await this.call("POST", "channels/group", { body: unique })),
        );
    }

    async createChannel(channel: {
        team_id: string;
        name: string;
        display_name: string;
        type: "O" | "P";
        purpose?: string;
        header?: string;
    }): Promise<MattermostChannel> {
        return this.rememberChannel(
            parseMattermostChannel(await this.call("POST", "channels", { body: channel })),
        );
    }

    async patchChannel(
        channelId: string,
        patch: Readonly<Record<string, unknown>>,
    ): Promise<MattermostChannel> {
        return this.rememberChannel(
            parseMattermostChannel(
                await this.call("PUT", `channels/${encodeId(channelId)}/patch`, { body: patch }),
            ),
        );
    }

    archiveChannel(channelId: string): Promise<unknown> {
        return this.call("DELETE", `channels/${encodeId(channelId)}`);
    }

    restoreChannel(channelId: string): Promise<unknown> {
        return this.call("POST", `channels/${encodeId(channelId)}/restore`);
    }

    async createPost(post: MattermostCreatePost, silent = false): Promise<MattermostPost> {
        return parseMattermostPost(
            await this.call("POST", "posts", { body: post, query: { silent } }),
        );
    }

    async getPost(postId: string): Promise<MattermostPost> {
        return parseMattermostPost(await this.call("GET", `posts/${encodeId(postId)}`));
    }

    async getPostsForChannel(
        channelId: string,
        options: {
            page?: number;
            perPage?: number;
            before?: string;
            after?: string;
            since?: number;
        } = {},
    ): Promise<MattermostPostList> {
        return parseMattermostPostList(
            await this.call("GET", `channels/${encodeId(channelId)}/posts`, {
                query: {
                    page: pageNumber(options.page || 0),
                    per_page: pageSize(options.perPage || 60),
                    before: options.before,
                    after: options.after,
                    since: options.since,
                },
            }),
        );
    }

    async getThread(postId: string): Promise<MattermostPostList> {
        return parseMattermostPostList(await this.call("GET", `posts/${encodeId(postId)}/thread`));
    }

    async getPinnedPosts(channelId: string): Promise<MattermostPostList> {
        return parseMattermostPostList(
            await this.call("GET", `channels/${encodeId(channelId)}/pinned`),
        );
    }

    async updatePost(postId: string, patch: Record<string, unknown>): Promise<MattermostPost> {
        return parseMattermostPost(
            await this.call("PUT", `posts/${encodeId(postId)}/patch`, { body: patch }),
        );
    }

    deletePost(postId: string): Promise<unknown> {
        return this.call("DELETE", `posts/${encodeId(postId)}`);
    }

    pinPost(postId: string, pinned = true): Promise<unknown> {
        return this.call("POST", `posts/${encodeId(postId)}/${pinned ? "pin" : "unpin"}`);
    }

    async addReaction(postId: string, emojiName: string): Promise<MattermostReaction> {
        return parseMattermostReaction(
            await this.call("POST", "reactions", {
                body: {
                    user_id: this.requireUserId(),
                    post_id: encodeId(postId),
                    emoji_name: requiredText(emojiName, "emoji_name"),
                },
            }),
        );
    }

    removeReaction(postId: string, emojiName: string): Promise<unknown> {
        return this.call(
            "DELETE",
            `users/${encodeId(this.requireUserId())}/posts/${encodeId(postId)}/reactions/${encodeURIComponent(requiredText(emojiName, "emoji_name"))}`,
        );
    }

    async listReactions(postId: string): Promise<MattermostReaction[]> {
        return parseArray(
            await this.call("GET", `posts/${encodeId(postId)}/reactions`),
            "reactions",
            parseMattermostReaction,
        );
    }

    async uploadFile(
        channelId: string,
        file: Blob,
        filename: string,
        clientId?: string,
    ): Promise<MattermostUploadResult> {
        const form = new FormData();
        form.append("channel_id", encodeId(channelId));
        form.append("files", file, requiredText(filename, "filename"));
        if (clientId) form.append("client_ids", clientId);
        return parseMattermostUploadResult(await this.call("POST", "files", { form }));
    }

    async getFileInfo(fileId: string): Promise<MattermostFileInfo> {
        return parseMattermostFileInfo(await this.call("GET", `files/${encodeId(fileId)}/info`));
    }

    addChannelMember(channelId: string, userId: string): Promise<unknown> {
        return this.call("POST", `channels/${encodeId(channelId)}/members`, {
            body: { user_id: encodeId(userId) },
        });
    }

    removeChannelMember(channelId: string, userId: string): Promise<unknown> {
        return this.call("DELETE", `channels/${encodeId(channelId)}/members/${encodeId(userId)}`);
    }

    async getStatus(userId = this.requireUserId()): Promise<MattermostStatus> {
        return parseMattermostStatus(await this.call("GET", `users/${encodeId(userId)}/status`));
    }

    async setStatus(status: MattermostStatus["status"]): Promise<MattermostStatus> {
        return parseMattermostStatus(
            await this.call("PUT", `users/${encodeId(this.requireUserId())}/status`, {
                body: { user_id: this.requireUserId(), status },
            }),
        );
    }

    markChannelRead(channelId: string, previousChannelId?: string): Promise<unknown> {
        return this.call("POST", `channels/members/${encodeId(this.requireUserId())}/view`, {
            body: {
                channel_id: encodeId(channelId),
                prev_channel_id: previousChannelId ? encodeId(previousChannelId) : undefined,
            },
        });
    }

    protected setCurrentUser(user: MattermostUser | undefined): void {
        this.currentUser = user;
    }

    protected rememberChannel(channel: MattermostChannel): MattermostChannel {
        this.channels.set(channel.id, channel);
        return channel;
    }

    private requireUserId(): string {
        if (!this.currentUser) {
            throw new MattermostError("Mattermost Client 尚未完成身份验证", {
                code: "MATTERMOST_NOT_STARTED",
            });
        }
        return this.currentUser.id;
    }
}

function parseArray<T>(value: unknown, field: string, parse: (item: unknown) => T): T[] {
    if (!Array.isArray(value)) throw MattermostError.invalid(`${field} 响应必须是数组`);
    return value.map(parse);
}

function encodeId(value: string): string {
    if (!/^[a-z0-9]+$/u.test(value)) throw MattermostError.invalid("Mattermost ID 无效");
    return encodeURIComponent(value);
}

function requiredText(value: string, field: string): string {
    if (!value?.trim()) throw MattermostError.invalid(`${field} 不能为空`);
    return value;
}

function pageNumber(value: number): number {
    if (!Number.isInteger(value) || value < 0) throw MattermostError.invalid("page 必须是非负整数");
    return value;
}

function pageSize(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 200) {
        throw MattermostError.invalid("per_page 必须是 1 到 200 的整数");
    }
    return value;
}

async function collectPages<T>(load: (page: number) => Promise<T[]>): Promise<T[]> {
    const result: T[] = [];
    for (let page = 0; ; page += 1) {
        const items = await load(page);
        result.push(...items);
        if (items.length < 200) return result;
    }
}
