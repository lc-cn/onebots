import type {QQAdapter} from "@/adapters/qq";
import axios,{AxiosInstance} from "axios";
import {WebSocket} from "ws";
import {EventEmitter} from "events";
import {util} from "icqq/lib/core/protobuf/protobuf.min";
import {SessionManager} from "@/adapters/qq/sessionManager";
import {OneBot} from "@/onebot";

export class QQBot extends EventEmitter{
    request:AxiosInstance
    ws:WebSocket
    sessionManager:SessionManager
    constructor(public oneBot:OneBot, public appId:string, public config:QQAdapter.Config['protocol']) {
        super()
        this.sessionManager=new SessionManager(this)
        this.request=axios.create({
            baseURL: this.config.sandbox?'https://sandbox.api.sgroup.qq.com':`https://api.sgroup.qq.com`,
            timeout: 5000,
            headers: {
                'User-Agent': `BotNodeSDK/0.0.1`
            }
        })
        this.request.interceptors.request.use((config)=>{
            config.headers['Authorization']=`QQBot ${this.sessionManager.token}`
            config.headers['X-Union-Appid']=this.appId
            if(config['rest']){
                const restObj=config['rest']
                delete config['rest']
                for(const key in restObj){
                    config.url=config.url.replace(':'+key,restObj[key])
                }
            }
            return config
        })
    }
    dispatchEvent(event: string, wsRes: any) {
        this.oneBot.logger.debug(event,wsRes)
        const payload = wsRes.d;
        const event_id = wsRes.id || '';
        if (!payload || !event) return;
        this.emit(QQEvent[event], { event, event_id, payload });
    }
    async init(){
        await this.sessionManager.init()
    }
    stop(){

    }
}
export enum QQEvent {
    C2C_MESSAGE_CREATE='message.private',
    GROUP_AT_MESSAGE_CREATE='message.group',
}
// 心跳参数
export enum OpCode {
    DISPATCH = 0, // 服务端进行消息推送
    HEARTBEAT = 1, // 客户端发送心跳
    IDENTIFY = 2, // 鉴权
    RESUME = 6, // 恢复连接
    RECONNECT = 7, // 服务端通知客户端重连
    INVALID_SESSION = 9, // 当identify或resume的时候，如果参数有错，服务端会返回该消息
    HELLO = 10, // 当客户端与网关建立ws连接之后，网关下发的第一条消息
    HEARTBEAT_ACK = 11, // 当发送心跳成功之后，就会收到该消息
}
export namespace QQBot{
    import resolve = util.path.resolve;

    export interface Token{
        access_token:string
        expires_in:number
        cache:string
    }
}
