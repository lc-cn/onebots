import { WebClient } from "@slack/web-api";
import { materializeMediaSource } from "onebots";
import { SlackError } from "./errors.js";
import { slackUploadMessageTimestamp, type SlackFileInput } from "./messages.js";
import type {
    SlackBlock,
    SlackChannel,
    SlackChatResult,
    SlackMessageOptions,
    SlackUser,
} from "./types.js";

interface SlackResult {
    ok?: boolean;
    error?: string;
}

/** Slack Web API 边界：统一分页、响应校验与结构化错误。 */
export class SlackWebApi {
    private readonly client: WebClient;

    constructor(token: string) {
        this.client = new WebClient(token);
    }

    get rawClient(): WebClient {
        return this.client;
    }

    async getBotInfo(): Promise<SlackUser> {
        const result = await this.execute("auth.test", () => this.client.auth.test());
        return { id: result.user_id || "", name: result.user || "" };
    }

    async sendMessage(
        channel: string,
        text: string,
        options?: SlackMessageOptions,
    ): Promise<SlackChatResult> {
        const result = await this.execute("chat.postMessage", () =>
            this.client.chat.postMessage({
                channel,
                text,
                ...(options as Record<string, unknown>),
            }),
        );
        return result as unknown as SlackChatResult;
    }

    async sendBlocks(
        channel: string,
        blocks: SlackBlock[],
        text?: string,
    ): Promise<SlackChatResult> {
        const result = await this.execute("chat.postMessage", () =>
            this.client.chat.postMessage({ channel, blocks, text: text || " " }),
        );
        return result as unknown as SlackChatResult;
    }

    async sendFiles(
        channel: string,
        files: SlackFileInput[],
        text: string,
        options: Pick<SlackMessageOptions, "thread_ts" | "blocks"> = {},
    ): Promise<SlackChatResult> {
        const media = await Promise.all(files.map(file => materializeMediaSource(file)));
        const result = await this.execute("files.uploadV2", () =>
            this.client.filesUploadV2({
                channel_id: channel,
                thread_ts: options.thread_ts,
                initial_comment: text || undefined,
                blocks: text ? undefined : options.blocks,
                file_uploads: media.map((item, index) => ({
                    file: Buffer.from(item.data),
                    filename: item.filename,
                    title: files[index].title,
                    alt_text: files[index].altText,
                })),
            }),
        );
        const timestamp = slackUploadMessageTimestamp(result);
        if (!timestamp) {
            throw SlackError.protocol(
                "Slack 文件上传响应缺少消息时间戳",
                "SLACK_UPLOAD_TIMESTAMP_MISSING",
                result,
            );
        }
        return { ...result, ok: true, channel, ts: timestamp } as SlackChatResult;
    }

    async updateMessage(
        channel: string,
        ts: string,
        text: string,
        options?: SlackMessageOptions,
    ): Promise<SlackChatResult> {
        const result = await this.execute("chat.update", () =>
            this.client.chat.update({
                channel,
                ts,
                text,
                ...(options as Record<string, unknown>),
            }),
        );
        return result as unknown as SlackChatResult;
    }

    async deleteMessage(channel: string, ts: string): Promise<boolean> {
        const result = await this.execute("chat.delete", () =>
            this.client.chat.delete({ channel, ts }),
        );
        return result.ok === true;
    }

    async getChannelInfo(channelId: string): Promise<SlackChannel> {
        const result = await this.execute("conversations.info", () =>
            this.client.conversations.info({ channel: channelId }),
        );
        if (!result.channel) {
            throw SlackError.protocol(
                "Slack 获取频道信息响应缺少 channel",
                "SLACK_CHANNEL_MISSING",
                result,
            );
        }
        return result.channel as SlackChannel;
    }

    async getChannelList(types?: string, excludeArchived?: boolean): Promise<SlackChannel[]> {
        return collectCursor(async cursor => {
            const result = await this.execute("conversations.list", () =>
                this.client.conversations.list({
                    types: types || "public_channel,private_channel",
                    exclude_archived: excludeArchived,
                    cursor,
                    limit: 200,
                }),
            );
            return {
                items: (result.channels ?? []) as SlackChannel[],
                next: result.response_metadata?.next_cursor || undefined,
            };
        });
    }

    async getUserInfo(userId: string): Promise<SlackUser> {
        const result = await this.execute("users.info", () =>
            this.client.users.info({ user: userId }),
        );
        if (!result.user) {
            throw SlackError.protocol(
                "Slack 获取用户信息响应缺少 user",
                "SLACK_USER_MISSING",
                result,
            );
        }
        return result.user as SlackUser;
    }

    async getUserList(): Promise<SlackUser[]> {
        return collectCursor(async cursor => {
            const result = await this.execute("users.list", () =>
                this.client.users.list({ cursor, limit: 200 }),
            );
            return {
                items: (result.members ?? []) as SlackUser[],
                next: result.response_metadata?.next_cursor || undefined,
            };
        });
    }

    async getChannelMembers(channelId: string): Promise<string[]> {
        return collectCursor(async cursor => {
            const result = await this.execute("conversations.members", () =>
                this.client.conversations.members({ channel: channelId, cursor, limit: 200 }),
            );
            return {
                items: result.members ?? [],
                next: result.response_metadata?.next_cursor || undefined,
            };
        });
    }

    async leaveChannel(channelId: string): Promise<boolean> {
        const result = await this.execute("conversations.leave", () =>
            this.client.conversations.leave({ channel: channelId }),
        );
        return result.ok === true;
    }

    async createChannel(name: string): Promise<SlackChannel> {
        const result = await this.execute("conversations.create", () =>
            this.client.conversations.create({ name }),
        );
        if (!result.channel?.id) {
            throw SlackError.protocol(
                "Slack 创建频道响应缺少频道信息",
                "SLACK_CHANNEL_MISSING",
                result,
            );
        }
        return {
            id: result.channel.id,
            name: result.channel.name ?? name,
            is_channel: result.channel.is_channel,
            is_private: result.channel.is_private,
        };
    }

    async kickChannelMember(channelId: string, userId: string): Promise<boolean> {
        const result = await this.execute("conversations.kick", () =>
            this.client.conversations.kick({ channel: channelId, user: userId }),
        );
        return result.ok === true;
    }

    async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (!method.trim()) {
            throw SlackError.invalid("Slack Web API method 不能为空", "SLACK_METHOD_REQUIRED");
        }
        return this.execute(method, () => this.client.apiCall(method, params));
    }

    private async execute<T extends SlackResult>(
        operation: string,
        task: () => Promise<T>,
    ): Promise<T> {
        try {
            const result = await task();
            if (result.ok === false) {
                throw new SlackError(
                    `Slack API ${operation} 调用失败: ${result.error || "unknown"}`,
                    {
                        operation,
                        platformCode: result.error,
                        details: result,
                    },
                );
            }
            return result;
        } catch (error) {
            throw SlackError.wrap(error, operation);
        }
    }
}

async function collectCursor<T>(
    load: (cursor?: string) => Promise<{ items: T[]; next?: string }>,
): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
        const page = await load(cursor);
        items.push(...page.items);
        if (page.next && seen.has(page.next)) {
            throw SlackError.protocol(
                "Slack 分页游标停滞，已终止目录读取",
                "SLACK_CURSOR_STALLED",
                { cursor: page.next },
            );
        }
        cursor = page.next;
        if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
}
