import {V12} from '@/service/V12'
import {OnlineStatus} from "icqq";
import {OneBotStatus} from "@/onebot";
import {getProperties,toLine} from '@/utils'
import {Action} from "./";
import {V11} from "@/service/V11";
export class CommonAction{
    sendMessage(){}
    /**
     * 撤回消息
     * @param message_id {string} 消息id
     */
    deleteMsg(this:V12,message_id:string){
        return this.client.deleteMsg(message_id)
    }
    getSelfInfo(this:V12){
        return {
            user_id:this.oneBot.uin+'',
            platform:'qq',
            nickname:this.client.nickname,
            user_displayname:''
        }
    }
    /**
     * 获取 Cookies
     * @param domain {string} 域名
     */
    getCookies(this:V11,domain:string):string{
        return this.client.cookies[domain]
    }

    getStatus(this:V12){
        return {
            good:this.oneBot.status===OneBotStatus.Good,
            bots:[
                {
                    self:this.action.getSelfInfo.apply(this),
                    online:this.client.status=OnlineStatus.Online,
                }
            ]
        }
    }
    getLatestEvents(this:V12,limit:number=0,timout:number=0):Promise<V12.Payload<keyof Action>[]>{
        return new Promise(resolve => {
            if(!this.history.length && timout!==0) {
                return setTimeout(()=>resolve(this.action.getLatestEvents.apply(this,[limit,timout])),timout*1000)
            }
            return resolve(this.history.reverse().filter((_,i)=>limit===0?true:i<limit))
        })
    }
    getVersion(this:V12){
        return {
            impl:'onebots',
            platform:'qq',
            version:'0.0.15',
            onebot_version:'12'
        }
    }
    callLogin(this:V12,func:string,...args:any[]){
        return new Promise(async resolve=>{
            const receiveResult=(event)=>{
                this.client.offTrap('system.login.qrcode',receiveResult)
                this.client.offTrap('system.login.device',receiveResult)
                this.client.offTrap('system.login.slider',receiveResult)
                this.client.offTrap('system.login.error',receiveResult)
                resolve(event)
            }
            this.client.trap('system.login.qrcode',receiveResult)
            this.client.trap('system.login.device',receiveResult)
            this.client.trap('system.login.slider',receiveResult)
            this.client.trap('system.login.error',receiveResult)
            this.client.trapOnce('system.online',receiveResult)
            try{
                await this.client[func](...args)
            }catch (reason){
                receiveResult(reason)
            }
        })
    }
    async submitSlider(this:V12,ticket:string){
        return this.action.callLogin.apply(this,['submitSlider',ticket])
    }
    async submitSmsCode(this:V12,code:string){
        return this.action.callLogin.apply(this,['submitSmsCode',code])
    }
    sendSmsCode(this:V12){
        return new Promise<any>(resolve=>{
            const receiveResult=(e)=>{
                const callback=(data)=>{
                    this.client.offTrap('internal.verbose',receiveResult)
                    this.client.offTrap('system.login.error',receiveResult)
                    resolve(data)
                }
                if((typeof e==='string' && e.includes('已发送')) || typeof e!=='string'){
                    callback(e)
                }
            }
            this.client.trap('internal.verbose',receiveResult)
            this.client.trap('system.login.error',receiveResult)
            this.client.sendSmsCode()
        })
    }
    login(this:V12,password?:string):Promise<unknown>{
        return this.action.callLogin.apply(this,['login',password])
    }
    logout(this:V12,keepalive?:boolean){
        return new Promise(async resolve => {
            const receiveResult=(e)=>{
                this.client.offTrap('system.offline',receiveResult)
                resolve(e)
            }
            this.client.on('system.offline',receiveResult)
            await this.client.logout(keepalive)
        })
    }
    getSupportedActions(this:V12):string[]{
        return [...new Set(getProperties(this.action))].filter(key=>{
            return key!=='constructor'
        }).map(toLine)
    }
}
