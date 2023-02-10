import {V12} from "../index";
import {remove} from "@/utils";

export class FriendAction{
    getUserInfo(this:V12,user_id:number){
        return this.client.getStrangerInfo(user_id)
    }
    getFriendList(this:V12){
        return this.client.getFriendList()
    }
    /**
     * 发送私聊消息
     * @param user_id {number} 用户id
     * @param message {import('icqq').Sendable} 发送的消息
     * @param message_id {string} 引用的消息ID
     */
    async sendPrivateMsg(this:V12,user_id:number,message:V12.SegmentElem[],message_id?:string){
        const forward =message.find(e=>e.type==='node') as V12.SegmentElem<'node'>
        if(forward) remove(message,forward)
        let quote=message.find(e=>e.type==='reply') as V12.SegmentElem<'reply'>
        if(quote)  remove(message,quote)
        const element=V12.fromSegment(message)
        if(forward) element.unshift(await this.client.makeForwardMsg(forward.data.message.map(segment=>{
            return {
                message:V12.fromSegment([segment]),
                user_id:forward.data.user_id,
                nickname:forward.data.user_name,
                time:forward.data.time
            }
        })))
        if(quote && !message_id) message_id=quote.data.message_id
        return await this.client.sendPrivateMsg(user_id,element,message_id?await this.client.getMsg(message_id):undefined)
    }
}
