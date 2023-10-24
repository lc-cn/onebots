import {V12} from "@/service/V12";
import {processMessage} from "@/service/V12/utils";
import {OneBot} from "@/onebot";

export class GuildAction {

    getGuildList(this: V12) {
        throw OneBot.UnsupportedMethodError
    }

    getChannelList(this: V12, guild_id: string) {
        throw OneBot.UnsupportedMethodError
    }

    getGuildMemberList(this: V12, guild_id: string) {
        throw OneBot.UnsupportedMethodError
    }

    /**
     * 发送群聊消息
     * @param guild_id {number} 频道id
     * @param channel_id {string} 子频道id
     * @param message {import('icqq/lib/service').Sendable} 消息
     */
    async sendGuildMsg(this: V12, guild_id: string, channel_id: string, message: V12.Sendable) {
        throw OneBot.UnsupportedMethodError
    }
}
