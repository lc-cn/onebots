import { DiscordBotGuildActions } from "./bot-guild-actions.js";
import { DiscordError } from "./errors.js";
import type { DiscordApiChannel, DiscordRole } from "./types.js";
import type { DiscordChannel } from "./bot-model.js";

/** Discord 频道与 Guild 角色资源动作。 */
export abstract class DiscordBotChannelActions extends DiscordBotGuildActions {
    async getChannel(channelId: string): Promise<DiscordChannel | null> {
        try {
            return await this.getREST().getChannel(channelId);
        } catch (error) {
            if (error instanceof DiscordError && error.status === 404) return null;
            throw error;
        }
    }

    async getGuildChannels(guildId: string): Promise<Map<string, DiscordChannel>> {
        const channels = await this.getREST().request<DiscordApiChannel[]>(
            `/guilds/${guildId}/channels`,
        );
        return new Map(channels.map(channel => [channel.id, channel]));
    }

    async createTextChannel(
        guildId: string,
        name: string,
        options?: { topic?: string; parent?: string; nsfw?: boolean },
    ): Promise<DiscordChannel> {
        return this.getREST().request<DiscordChannel>(`/guilds/${guildId}/channels`, {
            method: "POST",
            body: {
                name,
                type: 0,
                topic: options?.topic,
                parent_id: options?.parent,
                nsfw: options?.nsfw,
            },
        });
    }

    async deleteChannel(channelId: string): Promise<void> {
        await this.getREST().request(`/channels/${channelId}`, { method: "DELETE" });
    }

    async updateChannel(
        channelId: string,
        options: { name?: string; topic?: string; nsfw?: boolean; parent?: string },
    ): Promise<DiscordChannel> {
        return this.getREST().request<DiscordChannel>(`/channels/${channelId}`, {
            method: "PATCH",
            body: {
                name: options.name,
                topic: options.topic,
                nsfw: options.nsfw,
                parent_id: options.parent,
            },
        });
    }

    async getGuildRoles(guildId: string): Promise<Map<string, DiscordRole>> {
        const roles = await this.getREST().request<DiscordRole[]>(`/guilds/${guildId}/roles`);
        return new Map(roles.map(role => [role.id, role]));
    }

    async getRole(guildId: string, roleId: string): Promise<DiscordRole | null> {
        return (await this.getGuildRoles(guildId)).get(roleId) || null;
    }

    async createRole(
        guildId: string,
        options: {
            name: string;
            color?: number;
            hoist?: boolean;
            mentionable?: boolean;
            permissions?: bigint;
        },
    ): Promise<DiscordRole> {
        return this.getREST().request<DiscordRole>(`/guilds/${guildId}/roles`, {
            method: "POST",
            body: {
                name: options.name,
                color: options.color,
                hoist: options.hoist,
                mentionable: options.mentionable,
                permissions: options.permissions?.toString(),
            },
        });
    }

    async deleteRole(guildId: string, roleId: string): Promise<void> {
        await this.getREST().request(`/guilds/${guildId}/roles/${roleId}`, {
            method: "DELETE",
        });
    }
}
