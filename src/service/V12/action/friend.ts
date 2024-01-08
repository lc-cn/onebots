import {V12} from "../index";

export class FriendAction {
    getUserInfo(this: V12, user_id: number):Promise<V12.MessageRet> {
        return this.adapter.call(this.oneBot.uin,'V12','getUserInfo',[user_id])
    }

    getFriendList(this: V12) {
        return this.adapter.call(this.oneBot.uin,'V12','getFriendList')
    }

    /**
     * 发送私聊消息
     * @param user_id {number} 用户id
     * @param message {V12.Sendable} 消息
     * @param source {string} 引用id
     */
    async sendPrivateMsg(this: V12, user_id: number, message: V12.Sendable,source?:string) {
        return this.adapter.call(this.oneBot.uin,'V12','sendPrivateMessage', [user_id, message, source])
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
