import {V12} from "@/service/V12";

export class GuildAction {

    getGuildList(this: V12) {
        return this.adapter.call(this.oneBot.uin, 'V12', 'getGuildList')
    }

    getChannelList(this: V12, guild_id: string) {
        return this.adapter.call(this.oneBot.uin, 'V12', 'getChannelList', [guild_id])
    }

    getGuildMemberList(this: V12, guild_id: string) {
        return this.adapter.call(this.oneBot.uin, 'V12', 'getGuildMemberList', [guild_id])
    }

    /**
     * 发送群聊消息
     * @param guild_id {number} 频道id
     * @param channel_id {string} 子频道id
     * @param message {import('icqq/lib/service').Sendable} 消息
     */
    async sendGuildMsg(this: V12, guild_id: string, channel_id: string, message: V12.Sendable) {
        return this.adapter.call(this.oneBot.uin, 'V12', 'sendGuildMessage', [guild_id, channel_id, message])
    }
}
