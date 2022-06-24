import {EventEmitter} from 'events'
import {Logger} from "log4js";
import {App} from "./server/app";
import {deepMerge, pick} from "./utils";
import {LogLevel} from "./types";
import {join} from "path";
import {WebSocketServer,WebSocket} from "ws";
import {Client} from "oicq";
import {Service} from "./api";
import {util} from "oicq/lib/core/protobuf/protobuf.min";
import key2Re = util.key2Re;
export class OneBot extends EventEmitter{
    public config:OneBot.Config
    logger:Logger
    client:Client
    wss?:WebSocketServer
    wsr:Set<WebSocket>=new Set<WebSocket>()
    public service:Service<11 | 12>
    constructor(public app:App,public readonly uin:number,config:OneBot.Config={}){
        super()
        this.config=deepMerge(pick(app.config,['heartbeat','http','http_reverse','ws','ws_reverse','log_level','version']),config)
        this.logger=app.getLogger(uin)
        this.logger.level=this.config.log_level
        this.client=new Client(this.uin,{platform:5,log_level:this.config.log_level,data_dir:join(process.cwd(),'data')})
        this.service=new Service(this.client,this.config.version)
        const temp=this.service.apply('getLoginInfo')
    }
    start(){
        this.config.http && this.startHttp(this.config.http)
        for(const httpReverseConfig of this.config.http_reverse){
            this.startHttpReverse(httpReverseConfig)
        }
        this.config.ws && this.startWs(this.config.ws)
        for(const wsReverseConfig of this.config.ws_reverse){
            this.startWsReverse(wsReverseConfig)
        }
    }
    private startHttp(config:boolean|OneBot.AuthInfo){
        this.app.router.all(`/${this.uin}/:method`,async (ctx,next)=>{

        })
    }
    private startWs(config:boolean|OneBot.AuthInfo){
        this.wss=this.app.router.ws(`/${this.uin}`,this.app.httpServer)
    }
    private startHttpReverse(config:OneBot.WebHookConfig){

    }
    private startWsReverse(config:OneBot.WsReverseConfig){

    }
}
export namespace OneBot{
    export interface AuthInfo{
        access_token?:string
    }
    type LinkBase={
        host:string
        port:number
    }|{
        url:string
    }
    export type WebHookConfig = LinkBase & Partial<AuthInfo>
    export type WsReverseConfig=WebHookConfig & {
        reconnect_interval:number
    }
    export interface Config{
        heartbeat?:boolean|number
        version?:Service.Version
        password?:string
        log_level?:LogLevel
        http?:boolean|AuthInfo
        http_reverse?:WebHookConfig[]
        ws?:boolean|(AuthInfo & Pick<WsReverseConfig, 'reconnect_interval'>)
        ws_reverse?:WsReverseConfig[]
    }
}
