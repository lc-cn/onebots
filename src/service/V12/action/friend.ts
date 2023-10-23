import {V12} from "../index";
import {processMessage} from "@/service/V12/utils";

export class FriendAction {
    getUserInfo(this: V12, user_id: number) {
        return this.adapter.call('getUserInfo',[user_id])
    }

    getFriendList(this: V12) {
        return this.adapter.call('getFriendList')
    }

    /**
     * 发送私聊消息
     * @param user_id {number} 用户id
     * @param message {import('onebots/lib/service/v12').Sendable} 消息
     * @param source {import('onebots/lib/service/v12').SegmentElem<'reply'>} 引用内容
     */
    async sendPrivateMsg(this: V12, user_id: number, message: V12.Sendable,source?:V12.SegmentElem<'reply'>) {
        throw new Error('不支持的API')
    }
    /**
     * 为指定用户点赞
     * @param user_id {number} 用户id
     * @param times 点赞次数
     */
    async sendUserLike(this: V12, user_id: number, times?: number) {
        throw new Error('不支持的API')
    }
}
