import type { Account, Adapter, CommonTypes } from "onebots";
import { Satori } from "./types.js";

function toSatoriChannelType(value?: number): Satori.ChannelType {
    return value === 1 || value === 2 || value === 3 ? value : 0;
}

/** 消息与频道资源动作；负责 Satori Element 与通用消息段的边界转换。 */
export class SatoriMessageActions {
    constructor(
        private readonly adapter: Adapter,
        private readonly account: Account,
        private readonly serializeMessage: (segments: CommonTypes.Segment[]) => string,
    ) {}

    private convertMessageContent(segments: CommonTypes.Segment[]): string {
        return this.serializeMessage(segments);
    }

    // Action implementations
    /**
     * message.create - Send a message to a channel
     */
    async createMessage(params: Record<string, unknown>): Promise<Satori.Message[]> {
        const { channel_id, content } = params as {
            channel_id: string;
            content: string | Satori.Element[];
        };

        // Determine scene type: check if channel_id looks like a DM channel (dm_xxx or just user_id)
        const isDM = channel_id.startsWith("dm_") || !channel_id.includes("_");
        const sceneType: CommonTypes.Scene = isDM ? "private" : "group";
        const sceneId = isDM ? channel_id.replace("dm_", "") : channel_id;

        const result = await this.adapter.sendMessage(this.account.account_id, {
            scene_type: sceneType,
            scene_id: this.adapter.resolveId(sceneId),
            message: this.parseMessageContent(content),
        });

        return [
            {
                id: result.message_id.string,
                content: typeof content === "string" ? content : JSON.stringify(content),
            },
        ];
    }

    /**
     * message.get - Get a message by ID
     */
    async getMessage(params: Record<string, unknown>): Promise<Satori.Message> {
        const { message_id } = params as { message_id: string };

        const msg = await this.adapter.getMessage(this.account.account_id, {
            message_id: this.adapter.resolveId(message_id),
        });

        return {
            id: msg.message_id.string,
            content: this.convertMessageContent(msg.message),
            created_at: msg.time * 1000,
        };
    }

    /**
     * message.delete - Delete a message
     */
    async deleteMessage(params: Record<string, unknown>): Promise<void> {
        const { message_id } = params as { message_id: string };

        await this.adapter.deleteMessage(this.account.account_id, {
            message_id: this.adapter.resolveId(message_id),
        });
    }

    /**
     * message.update - Update/edit a message
     */
    async updateMessage(params: Record<string, unknown>): Promise<void> {
        const { message_id, content } = params as {
            message_id: string;
            content: string | Satori.Element[];
        };

        await this.adapter.updateMessage(this.account.account_id, {
            message_id: this.adapter.resolveId(message_id),
            message: this.parseMessageContent(content),
        });
    }

    /**
     * message.list - Get message history
     */
    async getMessageList(
        params: Record<string, unknown>,
    ): Promise<Satori.BidiList<Satori.Message>> {
        const { channel_id, limit } = params as {
            channel_id: string;
            limit?: number;
        };

        // Determine scene type
        const isDM = channel_id.startsWith("dm_") || !channel_id.includes("_");
        const sceneType: CommonTypes.Scene = isDM ? "private" : "group";
        const sceneId = isDM ? channel_id.replace("dm_", "") : channel_id;

        const messages = await this.adapter.getMessageHistory(this.account.account_id, {
            scene_type: sceneType,
            scene_id: this.adapter.resolveId(sceneId),
            limit: limit || 20,
        });

        return {
            data: messages.map(msg => ({
                id: msg.message_id.string,
                content: this.convertMessageContent(msg.message),
                created_at: msg.time * 1000,
            })),
        };
    }

    /**
     * channel.get - Get channel information
     * 使用真实 Channel API，不从 Group 模型猜测频道。
     */
    async getChannel(params: Record<string, unknown>): Promise<Satori.Channel> {
        const { channel_id, guild_id } = params as { channel_id: string; guild_id?: string };

        const info = await this.adapter.getChannelInfo(this.account.account_id, {
            channel_id: this.adapter.resolveId(channel_id),
            guild_id: guild_id ? this.adapter.resolveId(guild_id) : undefined,
        });

        return {
            id: info.channel_id.string,
            type: toSatoriChannelType(info.channel_type),
            name: info.channel_name,
            parent_id: info.parent_id?.string,
        };
    }

    /**
     * channel.list - Get channel list
     * 频道列表必须以 guild_id 定位，不回退到群列表。
     */
    async getChannelList(params: Record<string, unknown>): Promise<Satori.List<Satori.Channel>> {
        const { guild_id } = params as { guild_id: string };
        if (!guild_id) throw new TypeError("guild_id 必须是非空字符串");
        const channels = await this.adapter.getChannelList(this.account.account_id, {
            guild_id: this.adapter.resolveId(guild_id),
        });

        return {
            data: channels.map(channel => ({
                id: channel.channel_id.string,
                type: toSatoriChannelType(channel.channel_type),
                name: channel.channel_name,
                parent_id: channel.parent_id?.string,
            })),
        };
    }

    /**
     * channel.create - Create a new channel
     */
    async createChannel(params: Record<string, unknown>): Promise<Satori.Channel> {
        const { guild_id, name, type, parent_id } = params as {
            guild_id?: string;
            name?: string;
            type?: Satori.ChannelType;
            parent_id?: string;
        };

        const channel = await this.adapter.createChannel(this.account.account_id, {
            guild_id: guild_id ? this.adapter.resolveId(guild_id) : undefined,
            channel_name: name,
            channel_type: type,
            parent_id: parent_id ? this.adapter.resolveId(parent_id) : undefined,
        });

        return {
            id: channel.channel_id.string,
            type: type || 0,
            name: channel.channel_name,
            parent_id: channel.parent_id?.string,
        };
    }

    /**
     * channel.update - Update channel information
     */
    async updateChannel(params: Record<string, unknown>): Promise<void> {
        const { channel_id, name, parent_id } = params as {
            channel_id: string;
            name?: string;
            parent_id?: string;
        };

        await this.adapter.updateChannel(this.account.account_id, {
            channel_id: this.adapter.resolveId(channel_id),
            channel_name: name,
            parent_id: parent_id ? this.adapter.resolveId(parent_id) : undefined,
        });
    }

    /**
     * channel.delete - Delete a channel
     */
    async deleteChannel(params: Record<string, unknown>): Promise<void> {
        const { channel_id } = params as { channel_id: string };

        await this.adapter.deleteChannel(this.account.account_id, {
            channel_id: this.adapter.resolveId(channel_id),
        });
    }

    /**
     * Parse Satori message content (string or elements) to segments
     */
    private parseMessageContent(content: string | Satori.Element[]): CommonTypes.Segment[] {
        if (typeof content === "string") {
            // Simple text message
            return [{ type: "text", data: { text: content } }];
        }

        // Parse element array
        return content.map(el => {
            if (typeof el === "string") {
                return { type: "text", data: { text: el } };
            }
            return {
                type: el.type,
                data: el.attrs || {},
            };
        });
    }
}
