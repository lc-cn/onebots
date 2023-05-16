import {V12} from "@/service/V12";
import {processMessage} from "@/service/V12/utils";

export class GuildAction {

    getGuildList(this: V12) {
        return this.client.getGuildList()
    }

    getChannelList(this: V12, guild_id: string) {
        return this.client.getChannelList(guild_id)
    }

    getGuildMemberList(this: V12, guild_id: string) {
        return this.client.getGuildMemberList(guild_id)
    }

    /**
     * 发送群聊消息
     * @param guild_id {number} 频道id
     * @param channel_id {string} 子频道id
     * @param message {import('icqq/lib/service').Sendable} 消息
     */
    async sendGuildMsg(this: V12, guild_id: string, channel_id: string, message: V12.Sendable) {
        const {element} = await processMessage.apply(this, [message])
        if (!element.length) return
        return await this.client.sendGuildMsg(guild_id, channel_id, element)
    }
}
