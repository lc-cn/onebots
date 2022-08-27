import {V12} from '@/service/V12'
import {OnlineStatus} from "oicq";
import {OneBotStatus} from "@/onebot";
import {getProperties,toLine} from '@/utils'
import {Action} from "./";
export class CommonAction{
    sendMsg(){}
    /**
     * 撤回消息
     * @param message_id {string} 消息id
     */
    deleteMsg(this:V12,message_id:string){
        return this.client.deleteMsg(message_id)
    }
    getSelfInfo(this:V12){
        return {
            user_id:this.client.uin,
            nickname:this.client.nickname
        }
    }
    getStatus(this:V12){
        return {
            online:this.client.status=OnlineStatus.Online,
            good:this.oneBot.status===OneBotStatus.Good
        }
    }
    getLatestEvents(this:V12,limit=0,timout=0):Promise<V12.Payload<keyof Action>[]>{
        return new Promise(resolve => {
            if(!this.history.length && timout!==0) {
                return setTimeout(()=>resolve(this.action.getLatestEvents.apply(this,[limit,timout])),timout*1000)
            }
            return resolve(this.history.reverse().filter((_,i)=>limit===0?true:i<limit))
        })
    }
    getVersion(this:V12){
        return {
            impl:'oicq_onebot',
            platform:'qq',
            version:'0.0.1',
            onebot_version:'12'
        }
    }
    getSupportedActions(this:V12){
        return [...new Set(getProperties(this.action))].filter(key=>{
            return key!=='constructor'
        }).map(toLine)
    }
}
