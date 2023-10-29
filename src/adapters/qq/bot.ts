import type {QQAdapter} from "@/adapters/qq";
import axios,{AxiosInstance} from "axios";
import {WebSocket} from "ws";
import {EventEmitter} from "events";
import {util} from "icqq/lib/core/protobuf/protobuf.min";
import {SessionManager} from "@/adapters/qq/sessionManager";
import {toObject} from "@/adapters/qq/utils";
import {OneBot} from "@/onebot";

export class QQBot extends EventEmitter{
    request:AxiosInstance
    ws:WebSocket
    alive?:boolean
    sessionManager:SessionManager
    heartbeatInterval:number
    isReconnect:boolean
    sessionRecord = {
        sessionID: '',
        seq: 0,
    };
    heartbeatParam = {
        op: OpCode.HEARTBEAT,
        d: null, // 心跳唯一值
    };
    constructor(private oneBot:OneBot,public appId:string, public config:QQAdapter.Config['protocol']) {
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
    createWs(){
        this.ws=new WebSocket(this.sessionManager.wsUrl, {
            headers: {
                'Authorization': 'QQBot ' + this.sessionManager.token,
                'X-Union-Appid': this.appId
            }
        })
    }
    reconnectWs() {
        const reconnectParam = {
            op: OpCode.RESUME,
            d: {
                token: `QQBot ${this.sessionManager.token}`,
                session_id: this.sessionRecord.sessionID,
                seq: this.sessionRecord.seq,
            },
        };
        this.sendWs(reconnectParam);
    }

    // 发送websocket
    sendWs(msg: unknown) {
        try {
            // 先将消息转为字符串
            this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
        } catch (e) {
            this.oneBot.logger.info(e);
        }
    }
    authWs() {

        // 鉴权参数
        const authOp = {
            op: OpCode.IDENTIFY, // 鉴权参数
            d: {
                token: `QQBot ${this.sessionManager.token}`, // 根据配置转换token
                intents: this.sessionManager.getValidIntends(), // todo 接受的类型
                shard:  [0, 1], // 分片信息,给一个默认值
                properties: {
                    $os: 'linux',
                    $browser: 'my_library',
                    $device: 'my_library',
                },
            },
        };
        // 发送鉴权请求
        this.sendWs(authOp);
    }
    startListen(){
        this.ws.on('open',()=>{
            this.oneBot.logger.info('ws连接成功')
        })
        this.ws.on('message',(data)=>{
            // 先将消息解析
            const wsRes = toObject(data);
            // 先判断websocket连接是否成功
            if (wsRes?.op === OpCode.HELLO && wsRes?.d?.heartbeat_interval) {
                // websocket连接成功，拿到心跳周期
                this.heartbeatInterval = wsRes?.d?.heartbeat_interval;
                // 非断线重连时，需要鉴权
                this.isReconnect ? this.reconnectWs() : this.authWs();
                return;
            }

            // 鉴权通过
            if (wsRes.t === SessionEvents.READY) {
                this.oneBot.logger.info(`[CLIENT] 鉴权通过`);
                const { d, s } = wsRes;
                const { session_id } = d;
                // 获取当前会话参数
                if (session_id && s) {
                    this.sessionRecord.sessionID = session_id;
                    this.sessionRecord.seq = s;
                    this.heartbeatParam.d = s;
                }
                this.emit(SessionEvents.READY, { eventType: SessionEvents.READY, msg: d || '' });
                // 第一次发送心跳
                this.oneBot.logger.info(`[CLIENT] 发送第一次心跳`, this.heartbeatParam);
                this.sendWs(this.heartbeatParam);
                return;
            }
            // 心跳测试
            if (wsRes.op === OpCode.HEARTBEAT_ACK || wsRes.t === SessionEvents.RESUMED) {
                if (!this.alive) {
                    this.alive = true;
                    this.emit(SessionEvents.EVENT_WS, { eventType: SessionEvents.READY });
                }
                this.oneBot.logger.info('[CLIENT] 心跳校验', this.heartbeatParam);
                setTimeout(() => {
                    this.sendWs(this.heartbeatParam);
                }, this.heartbeatInterval);
            }

            // 收到服务端重连的通知
            if (wsRes.op === OpCode.RECONNECT) {
                // 通知会话，当前已断线
                this.emit(SessionEvents.EVENT_WS, { eventType: SessionEvents.RECONNECT });
            }

            // 服务端主动推送的消息
            if (wsRes.op === OpCode.DISPATCH) {
                // 更新心跳唯一值
                const { s } = wsRes;
                if (s) {
                    this.sessionRecord.seq = s;
                    this.heartbeatParam.d = s;
                }
                // OpenAPI事件分发
                this.dispatchEvent(wsRes.t, wsRes);
            }
        })
    }
    dispatchEvent(eventType: string, wsRes: any) {
        const msg = wsRes.d;
        const eventId = wsRes.id || '';
        // 如果没有事件，即刻退出
        if (!msg || !eventType) return;
        this.oneBot.logger.info(eventType,msg)
        this.emit(eventType, { eventType, eventId, msg });
    }
    async init(){
        await this.sessionManager.init()
        this.createWs()
        this.startListen()
    }
    stop(){

    }
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
export const SessionEvents = {
    CLOSED: 'CLOSED',
    READY: 'READY', // 已经可以通信
    ERROR: 'ERROR', // 会话错误
    INVALID_SESSION: 'INVALID_SESSION',
    RECONNECT: 'RECONNECT', // 服务端通知重新连接
    DISCONNECT: 'DISCONNECT', // 断线
    EVENT_WS: 'EVENT_WS', // 内部通信
    RESUMED: 'RESUMED', // 重连
    DEAD: 'DEAD', // 连接已死亡，请检查网络或重启
};
export namespace QQBot{
    import resolve = util.path.resolve;

    export interface Token{
        access_token:string
        expires_in:number
        cache:string
    }
}
