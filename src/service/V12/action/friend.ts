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
     * @param message {import('onebots/lib/service/v12').Sendable} 消息
     * @param quote {import('onebots/lib/service/v12').SegmentElem<'reply'>} 引用内容
     */
    async sendPrivateMsg(this: V12, user_id: number, message: V12.Sendable,quote?:V12.SegmentElem<'reply'>) {
        let {element, quote_id} = await processMessage.apply(this.client, [message,quote])
        element = await processMusic.apply(this.client, ['friend', user_id, element])
        if (!element.length) return
        return await this.client.sendPrivateMsg(user_id, element, quote_id ? await this.client.getMsg(quote_id) : undefined)
    }
}
