import {OnlineStatus, Sendable} from "oicq";
import {OneBot} from "@/onebot";
import {OneBotStatus} from "@/onebot";
export class CommonAction{
    /**
     * 获取登录信息
     */
    getLoginInfo(this:OneBot<'V11'>){
        return {
            user_id:this.client.uin,
            nickname:this.client.nickname
        }
    }

    /**
     * 发送消息
     * @param user_id {number} 用户id 和群id二选一
     * @param group_id {number} 群id 和用户id二选一
     * @param message {import('oicq').Sendable} 发送的消息
     */
    sendMsg(this:OneBot<'V11'>,user_id:number,message:Sendable)
    sendMsg(this:OneBot<'V11'>,group_id:number,message:Sendable){
        if(this.client.gl.get(group_id))return this.client.pickGroup(group_id).sendMsg(message)
        return this.client.pickFriend(group_id).sendMsg(message)
    }

    /**
     * 撤回消息
     * @param message_id {string} 消息id
     */
    deleteMsg(this:OneBot<'V11'>,message_id:string){
        return this.client.deleteMsg(message_id)
    }

    /**
     * 获取消息
     * @param message_id {string} 消息id
     */
    getMsg(this:OneBot<'V11'>,message_id:string){
        return this.client.getMsg(message_id)
    }

    /**
     * 获取合并消息
     * @param id {string} 合并id
     */
    getForwardMsg(this:OneBot<'V11'>,id:string){
        return this.client.getForwardMsg(id)
    }

    /**
     * 获取 Cookies
     * @param domain {string} 域名
     */
    getCookies(this:OneBot<'V11'>,domain:string){
        return this.client.cookies[domain]
    }

    /**
     * 获取 CSRF Token
     */
    getCsrfToken(this:OneBot<'V11'>){
        return this.client.getCsrfToken()
    }

    /**
     * 获取 QQ 相关接口凭证
     * @param domain
     */
    getCredentials(this:OneBot<'V11'>,domain:string){
        return {
            cookies:this.client.cookies[domain],
            csrf_token:this.client.getCsrfToken()
        }
    }

    /**
     * 获取版本信息
     */
    getVersion(this:OneBot<'V11'>){
        return {
            app_name:'oicq',
            app_version:'2.x',
            protocol_version:'v11'
        }
    }

    /**
     * 重启OneBot实现
     * @param delay {number} 要延迟的毫秒数
     */
    setRestart(this:OneBot<'V11'>,delay:number){
        return this.emit('restart',delay)
    }
    getStatus(this:OneBot<'V11'>){
        return {
            online:this.client.status=OnlineStatus.Online,
            good:this.status===OneBotStatus.Good
        }
    }
}
