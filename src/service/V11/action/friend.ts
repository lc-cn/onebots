import {OneBot} from "@/onebot";
import {Sendable} from "oicq";

export class FriendAction{
    /**
     * 发送私聊消息
     * @param user_id {number} 用户id
     * @param message {import('oicq').Sendable} 发送的消息
     */
    sendPrivateMsg(this:OneBot<'V11'>,user_id:number,message:Sendable){
        return this.client.sendPrivateMsg(user_id,message)
    }

    /**
     * 获取好友列表
     */
    async getFriendList(this:OneBot<'V11'>){
        return [...(await this.client.getFriendList()).values()]
    }

    /**
     * 处理好友添加请求
     * @param flag {string} 请求flag
     * @param approve {boolean} 是否同意
     * @param remark {string} 添加后的备注
     */
    async setFriendAddRequest(this:OneBot<'V11'>,flag:string,approve:boolean=true,remark:string=''){
        return await this.client.setFriendAddRequest(flag,approve,remark)
    }

    /**
     * 获取陌生人信息
     * @param user_id {number} 用户id
     */
    async getStrangerInfo(this:OneBot<'V11'>,user_id:number){
        return await this.client.getStrangerInfo(user_id)
    }

    /**
     * 发送好友赞
     * @param user_id {number} 用户id
     * @param times 点赞次数
     */
    async sendLike(this:OneBot<'V11'>,user_id:number,times?:number){
        return this.client.sendLike(user_id,times)
    }
}
