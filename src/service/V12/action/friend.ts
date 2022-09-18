import {V12} from "../index";
import {Sendable} from "icqq";

export class FriendAction{
    getUserInfo(this:V12,user_id:number){
        return this.client.getStrangerInfo(user_id)
    }
    getFriendList(this:V12){
        return this.client.getFriendList()
    }
    sendPrivateMsg(this:V12,user_id:number,message:Sendable){
        return this.client.sendPrivateMsg(user_id,message)
    }
}
