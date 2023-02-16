import {V12} from "../index";
import {processMessage, processMusic} from "@/service/V12/action/utils";

export class FriendAction {
    getUserInfo(this: V12, user_id: number) {
        return this.client.getStrangerInfo(user_id)
    }

    getFriendList(this: V12) {
        return this.client.getFriendList()
    }

    /**
     * 发送私聊消息
     * @param user_id {number} 用户id
     * @param message {import('icqq/lib/service').Sendable} 消息
     * @param message_id {string} 引用的消息ID
     */
    async sendPrivateMsg(this: V12, user_id: number, message: V12.Sendable, message_id?: string) {
        let {element, quote_id} = await processMessage.apply(this.client, [message, message_id])
        element = await processMusic.apply(this.client, ['friend', user_id, element])
        if (!element.length) return
        return await this.client.sendPrivateMsg(user_id, element, quote_id ? await this.client.getMsg(quote_id) : undefined)
    }
}
