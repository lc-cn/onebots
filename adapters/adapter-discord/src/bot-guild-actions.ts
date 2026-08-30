import { DiscordBotMessageActions } from "./bot-message-actions.js";
import {
    wrapDiscordMember,
    wrapDiscordUser,
    type DiscordGuild,
    type DiscordMember,
    type DiscordUser,
} from "./bot-model.js";
import { loadDiscordGuildMembers, loadDiscordGuilds } from "./resources.js";
import type { DiscordApiGuildMember } from "./types.js";

/** Discord 用户、Guild、成员审核与角色成员关系动作。 */
export abstract class DiscordBotGuildActions extends DiscordBotMessageActions {
    async getUser(userId: string): Promise<DiscordUser> {
        return wrapDiscordUser(await this.getREST().getUser(userId));
    }

    async getMember(guildId: string, userId: string): Promise<DiscordMember> {
        return wrapDiscordMember(await this.getREST().getGuildMember(guildId, userId));
    }

    async getGuilds(): Promise<Map<string, DiscordGuild>> {
        return loadDiscordGuilds(this.getREST(), this.guilds);
    }

    async getGuild(guildId: string): Promise<DiscordGuild> {
        const result = await this.getREST().getGuild(guildId);
        this.guilds.set(result.id, result);
        return result;
    }

    async getGuildMembers(guildId: string, limit?: number): Promise<Map<string, DiscordMember>> {
        return loadDiscordGuildMembers(this.getREST(), guildId, limit);
    }

    async getGuildMember(guildId: string, userId: string): Promise<DiscordMember> {
        return wrapDiscordMember(await this.getREST().getGuildMember(guildId, userId));
    }

    async kickMember(guildId: string, userId: string, reason?: string): Promise<void> {
        await this.getREST().removeGuildMember(guildId, userId, reason);
    }

    async banMember(
        guildId: string,
        userId: string,
        options?: { reason?: string; deleteMessageSeconds?: number },
    ): Promise<void> {
        await this.getREST().banGuildMember(guildId, userId, {
            delete_message_seconds: options?.deleteMessageSeconds,
            reason: options?.reason,
        });
    }

    async unbanMember(guildId: string, userId: string, reason?: string): Promise<void> {
        await this.getREST().request(`/guilds/${guildId}/bans/${userId}`, {
            method: "DELETE",
            reason,
        });
    }

    async timeoutMember(
        guildId: string,
        userId: string,
        duration: number,
        reason?: string,
    ): Promise<DiscordMember> {
        const until = new Date(Date.now() + duration * 1000).toISOString();
        return this.updateMember(guildId, userId, { communication_disabled_until: until }, reason);
    }

    async removeTimeout(guildId: string, userId: string, reason?: string): Promise<DiscordMember> {
        return this.updateMember(guildId, userId, { communication_disabled_until: null }, reason);
    }

    async setMemberNickname(
        guildId: string,
        userId: string,
        nickname: string | null,
        reason?: string,
    ): Promise<DiscordMember> {
        return this.updateMember(guildId, userId, { nick: nickname }, reason);
    }

    async addRole(
        guildId: string,
        userId: string,
        roleId: string,
        reason?: string,
    ): Promise<DiscordMember> {
        await this.updateMemberRole("PUT", guildId, userId, roleId, reason);
        return this.getGuildMember(guildId, userId);
    }

    async removeRole(
        guildId: string,
        userId: string,
        roleId: string,
        reason?: string,
    ): Promise<DiscordMember> {
        await this.updateMemberRole("DELETE", guildId, userId, roleId, reason);
        return this.getGuildMember(guildId, userId);
    }

    private async updateMember(
        guildId: string,
        userId: string,
        body: Readonly<Record<string, unknown>>,
        reason?: string,
    ): Promise<DiscordMember> {
        const result = await this.getREST().request<DiscordApiGuildMember>(
            `/guilds/${guildId}/members/${userId}`,
            { method: "PATCH", body, reason },
        );
        return wrapDiscordMember(result);
    }

    private async updateMemberRole(
        method: "PUT" | "DELETE",
        guildId: string,
        userId: string,
        roleId: string,
        reason?: string,
    ): Promise<void> {
        await this.getREST().request(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
            method,
            reason,
        });
    }
}
