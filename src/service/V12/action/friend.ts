import {V12} from "../index";
import {processMessage} from "@/service/V12/utils";
import {OneBot} from "@/onebot";

export class FriendAction {
    getUserInfo(this: V12, user_id: number) {
        return this.adapter.call(this.oneBot.uin,'V12','getUserInfo',[user_id])
    }

    getFriendList(this: V12) {
        return this.adapter.call(this.oneBot.uin,'V12','getFriendList')
    }

    /**
     * 发送私聊消息
     * @param user_id {number} 用户id
     * @param message {import('onebots/lib/service/v12').Sendable} 消息
     * @param source {import('onebots/lib/service/v12').SegmentElem<'reply'>} 引用内容
     */
    async sendPrivateMsg(this: V12, user_id: number, message: V12.Sendable,source?:V12.SegmentElem<'reply'>) {
        throw OneBot.UnsupportedMethodError
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
