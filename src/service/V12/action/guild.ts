import { V12 } from "@/service/V12";
import { Dict } from "@zhinjs/shared";

export class GuildAction {
    async getGuildSelfInfo(this: V12) {
        return this.adapter.call(this.oneBot.uin, "V12", "getSelfInfo");
    }
    async getChannelPermissionOfRole(this: V12, channel_id: string, role_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "getChannelPermissionOfRole", [
            channel_id,
            role_id,
        ]);
    }
    async setChannelAnnounce(this: V12, guild_id: string, channel_id: string, message_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "setChannelAnnounce", [
            guild_id,
            channel_id,
            message_id,
        ]);
    }
    async updateChannelPermissionOfRole(
        this: V12,
        channel_id: string,
        role_id: string,
        permission: Dict,
    ) {
        return this.adapter.call(this.oneBot.uin, "V12", "updateChannelPermissionOfRole", [
            channel_id,
            role_id,
            permission,
        ]);
    }
    async getChannelMemberPermission(this: V12, channel_id: string, member_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "getChannelMemberPermission", [
            channel_id,
            member_id,
        ]);
    }
    async updateChannelMemberPermission(
        this: V12,
        channel_id: string,
        member_id: string,
        permission: Dict,
    ) {
        return this.adapter.call(this.oneBot.uin, "V12", "updateChannelMemberPermission", [
            channel_id,
            member_id,
            permission,
        ]);
    }
    async getChannelPins(this: V12, channel_id: string): Promise<string[]> {
        return this.adapter.call(this.oneBot.uin, "V12", "getChannelPins", [channel_id]);
    }
    async pinChannelMessage(this: V12, channel_id: string, message_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "pinChannelMessage", [
            channel_id,
            message_id,
        ]);
    }
    async unPinChannelMessage(this: V12, channel_id: string, message_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "unPinChannelMessage", [
            channel_id,
            message_id,
        ]);
    }
    async createChannel(this: V12, guild_id: string, channelInfo: Dict) {
        return this.adapter.call(this.oneBot.uin, "V12", "createChannel", [guild_id, channelInfo]);
    }
    async updateChannel(this: V12, { channel_id, ...updateInfo }: { channel_id: string } & Dict) {
        return this.adapter.call(this.oneBot.uin, "V12", "updateChannel", [channel_id, updateInfo]);
    }
    async deleteChannel(this: V12, channel_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "deleteChannel", [channel_id]);
    }
    async getGuildRoles(this: V12, guild_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "getGuildRoles", [guild_id]);
    }
    async creatGuildRole(this: V12, guild_id: string, role: Dict) {
        return this.adapter.call(this.oneBot.uin, "V12", "creatGuildRole", [guild_id, role]);
    }
    async updateGuildRole(this: V12, guild_id: string, { id, ...role }) {
        return this.adapter.call(this.oneBot.uin, "V12", "updateGuildRole", [guild_id, role]);
    }
    async deleteGuildRole(this: V12, role_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "deleteGuildRole", [role_id]);
    }
    async getGuildAccessApis(this: V12, guild_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "getGuildAccessApis", [guild_id]);
    }
    async applyGuildAccess(
        this: V12,
        guild_id: string,
        channel_id: string,
        apiInfo: Dict,
        desc?: string,
    ) {
        return this.adapter.call(this.oneBot.uin, "V12", "applyGuildAccess", [
            guild_id,
            channel_id,
            apiInfo,
            desc,
        ]);
    }
    async unMuteGuild(this: V12, guild_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "unMuteGuild", [guild_id]);
    }
    async muteGuild(this: V12, guild_id: string, seconds: number, end_time?: number) {
        return this.adapter.call(this.oneBot.uin, "V12", "muteGuild", [
            guild_id,
            seconds,
            end_time,
        ]);
    }
    async unMuteGuildMembers(this: V12, guild_id: string, member_ids: string[]) {
        return this.adapter.call(this.oneBot.uin, "V12", "unMuteGuildMembers", [
            guild_id,
            member_ids,
        ]);
    }
    async muteGuildMembers(
        this: V12,
        guild_id: string,
        member_ids: string[],
        seconds: number,
        end_time?: number,
    ) {
        return this.adapter.call(this.oneBot.uin, "V12", "muteGuildMembers", [
            guild_id,
            member_ids,
            seconds,
            end_time,
        ]);
    }
    async addGuildMemberRoles(
        this: V12,
        guild_id: string,
        channel_id: string,
        member_id: string,
        role_id: string,
    ) {
        return this.adapter.call(this.oneBot.uin, "V12", "addGuildMemberRoles", [
            guild_id,
            channel_id,
            member_id,
            role_id,
        ]);
    }
    async removeGuildMemberRoles(
        this: V12,
        guild_id: string,
        channel_id: string,
        member_id: string,
        role_id: string,
    ) {
        return this.adapter.call(this.oneBot.uin, "V12", "removeGuildMemberRoles", [
            guild_id,
            channel_id,
            member_id,
            role_id,
        ]);
    }
    async kickGuildMember(
        this: V12,
        guild_id: string,
        member_id: string,
        clean: -1 | 0 | 3 | 7 | 15 | 30 = 0,
        blacklist?: boolean,
    ) {
        return this.adapter.call(this.oneBot.uin, "V12", "kickGuildMember", [
            guild_id,
            member_id,
            clean,
            blacklist,
        ]);
    }
    async unMuteGuildMember(this: V12, guild_id: string, member_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "unMuteGuildMember", [
            guild_id,
            member_id,
        ]);
    }
    async muteGuildMember(
        this: V12,
        guild_id: string,
        member_id: string,
        seconds: number,
        end_time?: number,
    ) {
        return this.adapter.call(this.oneBot.uin, "V12", "muteGuildMember", [
            guild_id,
            member_id,
            seconds,
            end_time,
        ]);
    }

    getGuildList(this: V12) {
        return this.adapter.call(this.oneBot.uin, "V12", "getGuildList");
    }
    getGuildInfo(this: V12, guild_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "getGuildInfo", [guild_id]);
    }
    getChannelList(this: V12, guild_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "getChannelList", [guild_id]);
    }
    getChannelInfo(this: V12, channel_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "getChannelInfo", [channel_id]);
    }

    getGuildMemberList(this: V12, guild_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "getGuildMemberList", [guild_id]);
    }

    /**
     * 发送频道消息
     * @param channel_id {string} 通道id
     * @param message {V12.Sendable} 消息
     * @param source
     */
    async sendGuildMsg(
        this: V12,
        channel_id: string,
        message: V12.Sendable,
        source?: string,
    ): Promise<V12.MessageRet> {
        return this.adapter.call(this.oneBot.uin, "V12", "sendGuildMessage", [
            channel_id,
            message,
            source,
        ]);
    }
    async createDirectSession(this: V12, guild_id: string, user_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "createDirectSession", [
            guild_id,
            user_id,
        ]);
    }
    async sendDirectMsg(
        this: V12,
        guild_id: string,
        message: V12.Sendable,
        source?: string,
    ): Promise<V12.MessageRet> {
        return this.adapter.call(this.oneBot.uin, "V12", "sendDirectMessage", [
            guild_id,
            message,
            source,
        ]);
    }
}
