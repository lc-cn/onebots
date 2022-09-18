import {V12} from '@/service/V12'
import {OnlineStatus} from "icqq";
import {OneBotStatus} from "@/onebot";
import {getProperties,toLine} from '@/utils'
import {Action} from "./";
import {V11} from "@/service/V11";
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
            impl:'icqq_onebot',
            platform:'qq',
            version:'0.0.1',
            onebot_version:'12'
        }
    }
    submitSlider(this:V11,ticket:string){
        return this.client.submitSlider(ticket)
    }
    submitSmsCode(this:V11,code:string){
        return this.client.submitSmsCode(code)
    }
    sendSmsCode(this:V11){
        return this.client.sendSmsCode()
    }
    login(this:V11,password?:string){
        const _this=this
        return new Promise(async resolve=>{
            const timer=setTimeout(()=>{
                resolve('登录超时')
            },5000)
            function receiveQrcode(event){
                _this.client.off('system.login.device',receiveDevice)
                _this.client.off('system.login.slider',receiveSlider)
                _this.client.off('system.online',closeListen)
                clearTimeout(timer)
                resolve(event)
            }
            function receiveDevice(event){
                _this.client.off('system.login.qrcode',receiveQrcode)
                _this.client.off('system.login.slider',receiveSlider)
                _this.client.off('system.online',closeListen)
                clearTimeout(timer)
                resolve(event)
            }
            function receiveError(event){
                clearTimeout(timer)
                resolve(event)
            }
            function receiveSlider(event){
                _this.client.off('system.login.qrcode',receiveQrcode)
                _this.client.off('system.login.device',receiveDevice)
                _this.client.off('system.online',closeListen)
                clearTimeout(timer)
                resolve(event)
            }
            function closeListen(){
                _this.client.off('system.login.slider',receiveSlider)
                _this.client.off('system.login.qrcode',receiveQrcode)
                _this.client.off('system.login.device',receiveDevice)
                clearTimeout(timer)
                resolve('登录成功')
            }
            this.client.once('system.login.qrcode',receiveQrcode)
            this.client.once('system.login.device',receiveDevice)
            this.client.once('system.login.slider',receiveSlider)
            this.client.once('system.login.error',receiveError)
            this.client.once('system.online',closeListen)
            await this.client.login(password).catch(()=>resolve('登录失败'))
        })
    }
    getSupportedActions(this:V12){
        return [...new Set(getProperties(this.action))].filter(key=>{
            return key!=='constructor'
        }).map(toLine)
    }
}
