import {Client} from "icqq";
import {Config} from "./config";
import {Action} from "./action";
import {OneBot} from "@/onebot";
import {Logger} from "log4js";
import {WebSocket, WebSocketServer} from "ws";
import {Dispose} from "@/types";
import {Context} from "koa";
import {URL} from "url";
import {toBool, toHump, toLine} from "@/utils";
import {fromCqcode, fromSegment, toCqcode, toSegment} from "icqq-cq-enable";
import {BOOLS, NotFoundError} from "@/onebot";
import http from "http";
import https from "https";
import {EventEmitter} from "events";

export class V11 extends EventEmitter implements OneBot.Base{
    action:Action
    public version='V11'
    protected timestamp = Date.now()
    protected heartbeat?: NodeJS.Timeout
    private path:string
    disposes:Dispose[]
    protected _queue: Array<{
        method: keyof Action,
        args: any[]
    }> = []
    protected queue_running:boolean = false
    logger:Logger
    wss?:WebSocketServer
    wsr:Set<WebSocket>=new Set<WebSocket>()
    constructor(public oneBot:OneBot<'V11'>,public client:Client,public config:V11.Config) {
        super()
        this.action=new Action()
        this.logger=this.oneBot.app.getLogger(this.client.uin,this.version)
    }

    start(path?:string) {
        this.path=`/${this.client.uin}`
        if(path)this.path+=path
        if(this.config.use_http) this.startHttp()
        if(this.config.use_ws) this.startWs()
        this.config.http_reverse.forEach(config=>{
            if(typeof config==='string'){
                config={
                    url:config,
                    access_token:this.config.access_token,
                    secret:this.config.secret
                }
            }else {
                config={
                    access_token:this.config.access_token,
                    secret:this.config.secret,
                    ...config
                }
            }
            this.startHttpReverse(config)
        })
        this.config.ws_reverse.forEach(config=>{
            this.startWsReverse(config)
        })

        if (this.config.heartbeat) {
            this.heartbeat = setInterval(() => {
                this.dispatch({
                    self_id: this.client.uin,
                    time: Math.floor(Date.now() / 1000),
                    post_type: "meta_event",
                    meta_event_type: "heartbeat",
                    interval: this.config.heartbeat*1000,
                })
            }, this.config.heartbeat*1000)
        }
    }
    private startHttp(){
        this.oneBot.app.router.all(new RegExp(`^${this.path}/(.*)$`), this._httpRequestHandler.bind(this))
        this.logger.mark(`开启http服务器成功，监听:http://127.0.0.1:${this.oneBot.app.config.port}${this.path}`)
    }
    private startHttpReverse(config:Config.HttpReverseConfig){
        this.on('dispatch',(unserialized:any)=>{
            const serialized=JSON.stringify(unserialized)
            const options: http.RequestOptions = {
                method: "POST",
                timeout: this.config.post_timeout * 1000,
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(serialized),
                    "X-Self-ID": String(this.client.uin),
                    "User-Agent": "OneBot",
                },
            }
            if (this.config.secret) {
                //@ts-ignore
                options.headers["X-Signature"] = "sha1=" + crypto.createHmac("sha1", String(this.config.secret)).update(serialized).digest("hex")
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
    private startWs(){

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
            if (this.config.access_token) {
                const url = new URL(req.url, "http://127.0.0.1")
                const token = url.searchParams.get('access_token')
                if (token)
                    req.headers["authorization"] = `Bearer ${token}`
                if (!req.headers["authorization"] || req.headers["authorization"] !== `Bearer ${this.config.access_token}`)
                    return ws.close(1002, "wrong access token")
            }
            this._webSocketHandler(ws)
        })
        this.on('dispatch',(serialized)=>{
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
    private startWsReverse(url:string){
        const ws=this._createWsr(url)
        this.on('dispatch',(unserialized)=>{
            if(this.wsr.has(ws)){
                ws.send(JSON.stringify(unserialized))
            }
        })
    }
    stop() {
        this.client.logout()
    }
    dispatch(data:any) {
        if(!data.post_type)data.post_type='system'
        if(data.post_type==='system'){

        }
        if(data.message && data.post_type==='message'){
            data.message=this.config.post_message_format==='array'? toSegment(data.message):toCqcode(data)
        }
        this.emit('dispatch',JSON.stringify(data))
    }
    private async _httpRequestHandler(ctx:Context){

        if (ctx.method === 'OPTIONS') {
            return ctx.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, authorization'
            }).end()
        }
        const url = new URL(ctx.url, `http://127.0.0.1`)
        if (this.config.access_token){
            if (ctx.headers["authorization"]) {
                if (ctx.headers["authorization"] !==`Bearer ${this.config.access_token}`)
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
     * 处理ws消息
     */
    protected _webSocketHandler(ws: WebSocket) {
        ws.on("message", async (msg) => {
            this.logger.info(" 收到ws消息：" + msg)
            var data
            try {
                data = JSON.parse(String(msg)) as V11.Protocol
                let ret: string
                if (data.action.startsWith(".handle_quick_operation")) {
                    const event = data.params.context, res = data.params.operation
                    this._quickOperate(event, res)
                    ret = JSON.stringify({
                        retcode: 0,
                        status: "async",
                        data: null,
                        error: null,
                        echo: data.echo
                    })
                } else {
                    ret = await this.apply(data)
                }
                ws.send(ret)
            } catch (e) {
                let code: number, message: string
                if (e instanceof NotFoundError) {
                    code = 1404
                    message = "不支持的api"
                } else {
                    code = 1400
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
        ws.send(JSON.stringify(V11.genMetaEvent(this.client.uin, "connect")))
        ws.send(JSON.stringify(V11.genMetaEvent(this.client.uin, "enable")))
    }
    /**
     * 创建反向ws
     */
    protected _createWsr(url: string) {
        const timestmap = Date.now()
        const headers: http.OutgoingHttpHeaders = {
            "X-Self-ID": String(this.client.uin),
            "X-Client-Role": "Universal",
            "User-Agent": "OneBot",
        }
        if (this.config.access_token)
            headers.Authorization = "Bearer " + this.config.access_token
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
                this._createWsr(url)
            }, this.config.reconnect_interval*1000)
        })
        return ws
    }

    /**
     * 快速操作
     */
    protected _quickOperate(event: any, res: any) {
        if (event.post_type === "message") {
            if (res.reply) {
                if (event.message_type === "discuss")
                    return
                const action = event.message_type === "private" ? "sendPrivateMsg" : "sendGroupMsg"
                const id = event.message_type === "private" ? event.user_id : event.group_id
                this.client[action](id, res.reply, res.auto_escape)
            }
            if (event.message_type === "group") {
                if (res.delete)
                    this.client.deleteMsg(event.message_id)
                if (res.kick && !event.anonymous)
                    this.client.setGroupKick(event.group_id, event.user_id, res.reject_add_request)
                if (res.ban)
                    this.client.setGroupBan(event.group_id, event.user_id, res.ban_duration > 0 ? res.ban_duration : 1800)
            }
        }
        if (event.post_type === "request" && "approve" in res) {
            const action = event.request_type === "friend" ? "setFriendAddRequest" : "setGroupAddRequest"
            this.client[action](event.flag, res.approve, res.reason ? res.reason : "", !!res.block)
        }
    }
    /**
     * 调用api
     */
    async apply(req: V11.Protocol) {
        let {action, params, echo} = req
        action=toLine(action)
        let is_async = action.includes("_async")
        if (is_async)
            action = action.replace("_async", "")
        let is_queue = action.includes("_rate_limited")
        if (is_queue)
            action = action.replace("_rate_limited", "")
        if(action==='send_msg'){
            if (["private", "group", "discuss"].includes(params.message_type)) {
                action = "send_" + params.message_type + "_msg"
            } else if (params.user_id)
                action = "send_private_msg"
            else if (params.group_id)
                action = "send_group_msg"
            else if (params.discuss_id)
                action = "send_discuss_msg"
            else throw new Error('required message_type or input (user_id/group_id)')
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
            if (is_queue) {
                this._queue.push({method, args})
                this._runQueue()
                result = V11.success(null,0,true)
            } else {
                try{
                    ret = this.action[method].apply(this,args)
                }catch (e){
                    return JSON.stringify(V11.error(e.message))
                }
                if (ret instanceof Promise) {
                    if (is_async) {
                        result = V11.success(null,0,true)
                    } else {
                        result = V11.success(await ret,0,false)
                    }
                } else {
                    result = V11.success(await ret,0,false)
                }
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
    /**
     * 限速队列调用
     */
    protected async _runQueue() {
        if (this.queue_running) return
        while (this._queue.length > 0) {
            this.queue_running = true
            const task = this._queue.shift()
            const {method, args} = task as typeof V11.prototype._queue[0]
            this.action[method].apply(this,args)
            await new Promise((resolve) => {
                setTimeout(resolve, this.config.rate_limit_interval*1000)
            })
            this.queue_running = false
        }
    }
}
export namespace V11{
    export interface Result<T extends any>{
        retcode: number,
        status: "success"|'async'|'error',
        data: T,
        error: string
    }
    export function success<T extends any>(data:T,retcode=0,pending?:boolean):Result<T>{
        return {
            retcode,
            status:pending?'async':'success',
            data,
            error:null
        }
    }
    export function error(error:string,retcode=1):Result<any>{
        return {
            retcode,
            status:'error',
            data:null,
            error
        }
    }
    export const defaultConfig:Config={
        heartbeat:3,
        access_token:'',
        post_timeout:15,
        secret:'',
        rate_limit_interval:4,
        post_message_format:'string',
        reconnect_interval:3,
        use_http:true,
        enable_cors:true,
        use_ws:true,
        http_reverse:[],
        ws_reverse:[]
    }
    export function genMetaEvent(uin: number, type: string) {
        return {
            self_id: uin,
            time: Math.floor(Date.now() / 1000),
            post_type: "meta_event",
            meta_event_type: "lifecycle",
            sub_type: type,
        }
    }
    export interface Protocol {
        action: string,
        params: any
        echo?: any
    }
    export interface Config{
        access_token?:string
        post_timeout?:number
        enable_cors?:boolean
        rate_limit_interval?:number
        post_message_format?:'string'|'array'
        heartbeat?:number
        secret?:string
        reconnect_interval?:number
        use_http?:boolean
        use_ws?:boolean
        http_reverse?:(string|Config.HttpReverseConfig)[]
        ws_reverse?:string[]
    }
}
