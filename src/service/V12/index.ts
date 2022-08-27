import {Client} from "oicq";
import {join} from 'path'
import {Config} from './config'
import {OneBot,BOOLS,NotFoundError} from "@/onebot";
import {Action} from "./action";
import {EventEmitter} from "events";
import {Logger} from "log4js";
import {Context} from "koa";
import {URL} from "url";
import http from "http";
import https from "https";
import {WebSocket, WebSocketServer} from "ws";
import {fromCqcode, fromSegment} from "oicq2-cq-enable";
import {toLine,toHump,toBool,uuid} from "@/utils";
import Payload = V12.Payload;
import {Db} from "@/db";
import {App} from "@/server/app";

export class V12 extends EventEmitter implements OneBot.Base{
    public version='V12'
    action:Action
    protected timestamp = Date.now()
    protected heartbeat?: NodeJS.Timeout
    logger:Logger
    private path:string
    wss?:WebSocketServer
    wsr:Set<WebSocket>=new Set<WebSocket>()
    private db:Db
    constructor(public oneBot:OneBot<'V12'>,public client:Client,public config:V12.Config) {
        super()
        this.db=new Db(join(App.configDir,'data',this.client.uin+'.json'))
        if(!this.history) this.db.set('eventBuffer',[])
        this.action=new Action()
        this.logger=this.oneBot.app.getLogger(this.client.uin,this.version)
    }
    get history():Payload<keyof Action>[]{
        return this.db.get('eventBuffer')
    }
    start(path?:string) {
        this.path=`/${this.client.uin}`
        if(path)this.path+=path
        if(this.config.use_http) {
            const config:V12.HttpConfig= typeof this.config.use_http==='boolean'?{}:this.config.use_http||{}
            this.startHttp({
                access_token:this.config.access_token,
                event_enabled:true,
                event_buffer_size:50,
                ...config
            })
        }
        if(this.config.use_ws) {
            const config:V12.WsConfig=typeof this.config.use_ws==='boolean'?{}:this.config.use_ws||{}
            this.startWs({
                access_token:this.config.access_token,
                ...config
            })
        }
        this.config.webhook.forEach(config=>{
            if(typeof config==='string'){
                config={
                    url:config,
                    access_token:this.config.access_token,
                }
            }else{
                config={
                    access_token:this.config.access_token,
                    ...config
                }
            }
            this.startWebhook(config)
        })
        this.config.ws_reverse.forEach(config=>{
            if(typeof config==='string'){
                config={
                    url:config,
                    access_token:this.config.access_token,
                }
            }else{
                config={
                    access_token:this.config.access_token,
                    ...config
                }
            }
            this.startWsReverse(config)
        })

        if (this.config.heartbeat) {
            this.heartbeat = setInterval(() => {
                this.dispatch({
                    self_id: this.client.uin,
                    time: Math.floor(Date.now() / 1000),
                    type: "meta",
                    detail_type: "heartbeat",
                    interval: this.config.heartbeat*1000,
                    status:this.action.getStatus.apply(this)
                })
            }, this.config.heartbeat*1000)
        }
    }
    private startHttp(config:V12.HttpConfig){
        this.oneBot.app.router.all(new RegExp(`^${this.path}/(.*)$`), (ctx)=>this._httpRequestHandler(ctx,config))
        this.logger.mark(`开启http服务器成功，监听:http://127.0.0.1:${this.oneBot.app.config.port}${this.path}`)
        this.on('dispatch',(payload:Payload<keyof Action>)=>{
            if(!['message','notice','request','system'].includes(payload.type)) return
            if(config.event_enabled){
                this.history.push(payload)
                if(config.event_buffer_size!==0 && this.history.length>config.event_buffer_size) this.history.shift()
            }
        })
    }
    private startWebhook(config:V12.WebhookConfig){
        this.on('dispatch',(unserialized:any)=>{
            const serialized=JSON.stringify(unserialized)
            const options: http.RequestOptions = {
                method: "POST",
                timeout: this.config.request_timeout * 1000,
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(serialized),
                    "X-Self-ID": String(this.client.uin),
                    "User-Agent": "OneBot",
                },
            }
            const protocol = config.url.startsWith("https") ? https : http
            try {
                protocol.request(config.url, options, (res) => {
                    if (res.statusCode !== 200)
                        return this.logger.warn(`POST(${config.url})上报事件收到非200响应：` + res.statusCode)
                    let data = ""
                    res.setEncoding("utf-8")
                    res.on("data", (chunk) => data += chunk)
                    res.on("end", () => {
                        this.logger.debug(`收到HTTP响应 ${res.statusCode} ：` + data)
                        if (!data)
                            return
                        try {
                            this._quickOperate(unserialized, JSON.parse(data))
                        } catch (e) {
                            this.logger.error(`快速操作遇到错误：` + e.message)
                        }
                    })
                }).on("error", (err) => {
                    this.logger.error(`POST(${config.url})上报事件失败：` + err.message)
                }).end(serialized, () => {
                    this.logger.debug(`POST(${config.url})上报事件成功: ` + serialized)
                })
            } catch (e) {
                this.logger.error(`POST(${config.url})上报失败：` + e.message)
            }
        })
    }
    private startWs(config:V12.WsConfig){
        this.wss = this.oneBot.app.router.ws(this.path, this.oneBot.app.httpServer)
        this.logger.mark(`开启ws服务器成功，监听:ws://127.0.0.1:${this.oneBot.app.config.port}${this.path}`)
        this.wss.on("error", (err) => {
            this.logger.error(err.message)
        })
        this.wss.on("connection", (ws, req) => {
            this.logger.info(`ws客户端(${req.headers.origin})已连接`)
            ws.on("error", (err) => {
                this.logger.error(`ws客户端(${req.headers.origin})报错：${err.message}`)
            })
            ws.on("close", (code, reason) => {
                this.logger.warn(`ws客户端(${req.headers.origin})连接关闭，关闭码${code}，关闭理由：` + reason)
            })
            if (config.access_token) {
                const url = new URL(req.url, "http://127.0.0.1")
                const token = url.searchParams.get('access_token')
                if (token)
                    req.headers["authorization"] = `Bearer ${token}`
                if (!req.headers["authorization"] || req.headers["authorization"] !== `Bearer ${config.access_token}`)
                    return ws.close(1002, "wrong access token")
            }
            this._webSocketHandler(ws)
        })
        this.on('dispatch',(unserialized)=>{
            const serialized=JSON.stringify(unserialized)
            for (const ws of this.wss.clients) {
                ws.send(serialized, (err) => {
                    if (err)
                        this.logger.error(`正向WS(${ws.url})上报事件失败: ` + err.message)
                    else
                        this.logger.debug(`正向WS(${ws.url})上报事件成功: ` + serialized)
                })
            }
        })
    }
    private startWsReverse(config:V12.WsReverseConfig){
        const ws=this._createWsr(config.url,config)
        this.on('dispatch',(unserialized)=>{
            if(this.wsr.has(ws)){
                ws.send(JSON.stringify(unserialized))
            }
        })
    }
    stop() {
        return this.client.logout()
    }
    dispatch<T extends Record<string, any>>(data:T= {} as any) {
        if(!data)data={} as any
        if(!data.post_type){
            // @ts-ignore
            data.sub_type='online'
            if(data.image){
                // @ts-ignore
                data.system_type='login'
                // @ts-ignore
                data.sub_type='qrcode'
            }
            else if(data.url){
                // @ts-ignore
                data.system_type='login'
                // @ts-ignore
                data.sub_type='slider'
                if(data.phone){
                    // @ts-ignore
                    data.sub_type='device'
                }
            }else if(data.message){
                // @ts-ignore
                data.system_type='login'
                // @ts-ignore
                data.sub_type='error'
            }
        }
        const payload:V12.Payload<T>={
            id:uuid(),
            impl:'oicq_onebot',
            platform:'qq',
            self_id:`${this.client.uin}`,
            type:data.post_type|| 'meta',
            detail_type:data.message_type||data.notice_type||data.request_type||data.system_type,
            ...data,
        } as V12.Payload<T>
        if(payload.type==='notice'){
            switch (payload.detail_type){
                case 'friend':
                    payload.detail_type+=payload.sub_type
                    break;
                case 'group':
                    if(['increase','decrease'].includes(payload.sub_type))payload.detail_type='group_member_'+payload.sub_type
                    else if(payload.sub_type==='recall') payload.detail_type='group_message_delete'
            }
        }
        this.emit('dispatch',payload)
    }
    async apply(req){
        let {action, params, echo} = req
        action=toLine(action)
        let is_async = action.includes("_async")
        if (is_async)
            action = action.replace("_async", "")
        if(action==='send_msg'){
            if (["private", "group", "discuss",'channel'].includes(params.detail_type)) {
                action = "send_" + params.detail_type + "_msg"
            } else if (params.user_id)
                action = "send_private_msg"
            else if (params.group_id)
                action = "send_group_msg"
            else if (params.discuss_id)
                action = "send_discuss_msg"
            else if(params.channel_id&&params.guild_id)
                action= "send_guild_msg"
            else throw new Error('required detail_type or input (user_id/group_id/(guild_id and channel_id))')
        }
        const method = toHump(action) as keyof Action
        if(Reflect.has(this.action,method)){
            const ARGS=String(Reflect.get(this.action,method)).match(/\(.*\)/)?.[0]
                .replace("(","")
                .replace(")","")
                .split(",")
                .filter(Boolean).map(v=>v.replace(/=.+/, "").trim())
            const args = []
            for (let k of ARGS) {
                if (Reflect.has(params, k)) {
                    if (BOOLS.includes(k))
                        params[k] = toBool(params[k])
                    if (k === 'message') {
                        if (typeof params[k] === 'string') {
                            params[k] = fromCqcode(params[k])
                        } else {
                            params[k] = fromSegment(params[k])
                        }
                    }
                    args.push(params[k])
                }
            }
            let ret: any, result: any
            try{
                ret = this.action[method].apply(this,args)
            }catch (e){
                return JSON.stringify(V12.error(e.message))
            }
            if (ret instanceof Promise) {
                if (is_async) {
                    result = V12.success(null,0)
                } else {
                    result = V12.success(await ret,0)
                }
            } else {
                result = V12.success(await ret,0)
            }
            if (result.data instanceof Map)
                result.data = [...result.data.values()]

            if (echo) {
                result.echo = echo
            }
            return JSON.stringify(result)
        }else
            throw new NotFoundError()
    }

    private async _httpRequestHandler(ctx:Context,config:V12.HttpConfig){

        if (ctx.method === 'OPTIONS') {
            return ctx.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, authorization'
            }).end()
        }
        const url = new URL(ctx.url, `http://127.0.0.1`)
        if (config.access_token){
            if (ctx.headers["authorization"]) {
                if (ctx.headers["authorization"] !==`Bearer ${config.access_token}`)
                    return ctx.res.writeHead(403).end()
            } else {
                const access_token = url.searchParams.get("access_token")
                if (!access_token)
                    return ctx.res.writeHead(401).end()
                else if (access_token!==this.config.access_token)
                    return ctx.res.writeHead(403).end()
            }
        }
        ctx.res.setHeader("Content-Type", "application/json; charset=utf-8")
        if (this.config.enable_cors)
            ctx.res.setHeader("Access-Control-Allow-Origin", "*")
        const action = url.pathname.replace(`${this.path}`, '').slice(1)
        if (ctx.method === "GET") {
            try {
                const ret = await this.apply({action, params: ctx.query})
                ctx.res.writeHead(200).end(ret)
            } catch (e) {
                ctx.res.writeHead(500).end(e.message)
            }
        } else if (ctx.method === "POST") {
            try {
                const params = {...ctx.query, ...ctx.request.body}
                const ret = await this.apply({action, params})
                ctx.res.writeHead(200).end(ret)
            } catch (e) {
                ctx.res.writeHead(500).end(e.message)
            }
        } else {
            ctx.res.writeHead(405).end()
        }
    }
    /**
     * 快速操作
     */
    protected _quickOperate(event: any, res: any) {
        if (event.type === "message") {
            if (res.reply) {
                if (event.detail_type === "discuss")
                    return
                const action = event.detail_type === "private" ? "sendPrivateMsg" : "sendGroupMsg"
                const id = event.detail_type === "private" ? event.user_id : event.group_id
                this.client[action](id, res.reply, res.auto_escape)
            }
            if (event.detail_type === "group") {
                if (res.delete)
                    this.client.deleteMsg(event.message_id)
                if (res.kick && !event.anonymous)
                    this.client.setGroupKick(event.group_id, event.user_id, res.reject_add_request)
                if (res.ban)
                    this.client.setGroupBan(event.group_id, event.user_id, res.ban_duration > 0 ? res.ban_duration : 1800)
            }
        }
        if (event.type === "request" && "approve" in res) {
            const action = event.detail_type === "friend" ? "setFriendAddRequest" : "setGroupAddRequest"
            this.client[action](event.flag, res.approve, res.reason ? res.reason : "", !!res.block)
        }
    }
    /**
     * 创建反向ws
     */
    protected _createWsr(url: string,config:V12.WsReverseConfig) {
        const timestmap = Date.now()
        const headers: http.OutgoingHttpHeaders = {
            "X-Self-ID": String(this.client.uin),
            "X-Client-Role": "Universal",
            "User-Agent": "OneBot",
        }
        if (config.access_token)
            headers.Authorization = "Bearer " + config.access_token
        const ws = new WebSocket(url, {headers})
        ws.on("error", (err) => {
            this.logger.error(err.message)
        })
        ws.on("open", () => {
            this.logger.info(`反向ws(${url})连接成功。`)
            this.wsr.add(ws)
            this._webSocketHandler(ws)
        })
        ws.on("close", (code) => {
            this.wsr.delete(ws)
            if (timestmap < this.timestamp)
                return
            this.logger.warn(`反向ws(${url})被关闭，关闭码${code}，将在${this.config.reconnect_interval}秒后尝试重连。`)
            setTimeout(() => {
                if (timestmap < this.timestamp)
                    return
                this._createWsr(url,config)
            }, this.config.reconnect_interval*1000)
        })
        return ws
    }
    /**
     * 处理ws消息
     */
    protected _webSocketHandler(ws: WebSocket) {
        ws.on("message", async (msg) => {
            this.logger.debug(" 收到ws消息：" + msg)
            var data
            try {
                data = JSON.parse(String(msg)) as V12.Protocol
                let ret: string
                if (data.action.startsWith(".handle_quick_operation")) {
                    const event = data.params.context, res = data.params.operation
                    this._quickOperate(event, res)
                    ret = JSON.stringify({
                        retcode: 0,
                        status: "ok",
                        data: null,
                        message: null,
                        echo: data.echo
                    })
                } else {
                    ret = await this.apply(data)
                }
                ws.send(ret)
            } catch (e) {
                let code: number, message: string
                if (e instanceof NotFoundError) {
                    code = 10002
                    message = "不支持的api"
                } else {
                    code = 10003
                    message = "请求格式错误"
                }
                ws.send(JSON.stringify({
                    retcode: code,
                    status: "failed",
                    data: null,
                    error: {
                        code, message
                    },
                    echo: data?.echo
                }))
            }
        })
        this.dispatch(V12.genMetaEvent(this.client.uin, "connect"))
        this.dispatch(V12.genMetaEvent(this.client.uin, "enable"))
    }

}
export namespace V12{
    export interface Config{
        heartbeat?:number
        access_token?:string
        request_timeout?:number
        reconnect_interval?:number
        enable_cors?:boolean
        use_http?:boolean|HttpConfig
        webhook?:(string|WebhookConfig)[]
        use_ws?:boolean|WsConfig
        ws_reverse?:(string| WsReverseConfig)[]
    }
    export interface HttpConfig extends Config.AuthInfo,Config.EventBufferConfig{}
    export interface WebhookConfig extends Config.AuthInfo{
        url:string
    }
    export interface WsConfig extends Config.AuthInfo{}
    export interface WsReverseConfig extends Config.AuthInfo{
        url:string
    }
    export interface Result<T extends any>{
        status:'ok'|'failed'
        retcode:0|10001|10002|10003|10004|10005|10006|10007
        data:T
        message:string
        echo?:string
    }
    export const defaultConfig:Config={
        heartbeat:3,
        access_token:'',
        request_timeout:15,
        reconnect_interval:3,
        enable_cors:true,
        use_http:true,
        use_ws:true,
        webhook:[],
        ws_reverse:[]
    }
    export type Payload<T extends any>={
        id:string
        impl:'oicq_onebot'
        platform:'qq'
        self_id:`${number}`
        time:number
        type:'meta'|'message'|'notice'|'request'
        detail_type:string
        sub_type:string
    } & T
    export interface Protocol {
        action: string,
        params: any
        echo?: string
    }
    export function success<T extends any>(data:T,retcode:Result<T>['retcode']=0,echo?:string):Result<T>{
        return {
            retcode,
            status:retcode===0?'ok':'failed',
            data,
            message:'',
            echo
        }
    }
    export function error(message:string,retcode:Result<null>['retcode']=10001,echo?:string):Result<null>{
        return {
            retcode,
            status:'failed',
            data:null,
            message,
            echo
        }
    }
    export function genMetaEvent(uin: number, type: string) {
        return {
            self_id: uin,
            time: Math.floor(Date.now() / 1000),
            type: "meta",
            detail_type: "lifecycle",
            sub_type: type,
        }
    }
}
