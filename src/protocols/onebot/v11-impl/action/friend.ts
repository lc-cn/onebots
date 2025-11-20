import { V11 } from "@/service/V11";

export class FriendAction {
    /**
     * 发送私聊消息
     * @param user_id {number} 用户id
     * @param message {V11.Sendable} 发送的消息
     * @param message_id {number} 引用的消息ID
     */
    async sendPrivateMsg(
        this: V11,
        user_id: number,
        message: V11.Sendable,
        message_id?: number,
    ): Promise<V11.MessageRet> {
        const msg_id = message_id ? this.getStrByInt("message_id", message_id) : undefined;
        const uid = this.getStrByInt("user_id", user_id);
        return this.adapter.call(this.oneBot.uin, "V11", "sendPrivateMessage", [
            uid,
            message,
            msg_id,
        ]);
    }

    /**
     * 发送转发消息
     * @param user_id {number} 用户id
     * @param messages {V11.MessageNode[]} 转发节点
     */
    async sendPrivateForwardMsg(this: V11, user_id: number, messages: V11.MessageNode[]) {
        const uid = this.getStrByInt("user_id", user_id);
        return this.adapter.call(this.oneBot.uin, "V11", "sendPrivateForwardMessage", [
            uid,
            messages,
        ]);
    }
    /**
     * 获取好友列表
     */
    async getFriendList(this: V11) {
        return this.adapter.call(this.oneBot.uin, "V11", "getFriendList");
    }

    /**
     * 处理好友添加请求
     * @param flag {string} 请求flag
     * @param approve {boolean} 是否同意
     * @param remark {string} 添加后的备注
     */
    async setFriendAddRequest(
        this: V11,
        flag: string,
        approve: boolean = true,
        remark: string = "",
    ) {
        return this.adapter.call(this.oneBot.uin, "V11", "setFriendAddRequest", [
            flag,
            approve,
            remark,
        ]);
    }

    /**
     * 获取陌生人信息
     * @param user_id {number} 用户id
     */
    async getStrangerInfo(this: V11, user_id: number) {
        return this.adapter.call(this.oneBot.uin, "V11", "getStrangerInfo", [user_id]);
    }

    /**
     * 为指定用户点赞
     * @param user_id {number} 用户id
     * @param times 点赞次数
     */
    async sendLike(this: V11, user_id: number, times?: number) {
        return this.adapter.call(this.oneBot.uin, "V11", "sendLike", [user_id, times]);
    }
}
