import {V12} from "../index";
import {processMessage} from "@/service/V12/action/utils";

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
     * @param source {import('onebots/lib/service/v12').SegmentElem<'reply'>} 引用内容
     */
    async sendPrivateMsg(this: V12, user_id: number, message: V12.Sendable,source?:V12.SegmentElem<'reply'>) {
        let {element, quote,music,share} = await processMessage.apply(this.client, [message,source])
        if(music) await this.client.pickUser(user_id).shareMusic(music.data.platform,music.data.id)
        if(share) await this.client.pickUser(user_id).shareUrl(music.data)
        if(element.length) {
            return await this.client.sendPrivateMsg(user_id, element, quote ? await this.client.getMsg(quote.data.message_id) : undefined)
        }
    }
    /**
     * 为指定用户点赞
     * @param user_id {number} 用户id
     * @param times 点赞次数
     */
    async sendUserLike(this: V12, user_id: number, times?: number) {
        return this.client.sendLike(user_id, times)
    }
}
