import {Client, EventMap, MessageElem, OnlineStatus, Sendable as IcqqCanSend} from "icqq";
import {version} from "@/utils";
import {join} from 'path'
import {Config} from './config'
import {BOOLS, NotFoundError, OneBot} from "@/onebot";
import {Action} from "./action";
import {EventEmitter} from "events";
import {Logger} from "log4js";
import {Context} from "koa";
import {URL} from "url";
import http from "http";
import https from "https";
import {WebSocket, WebSocketServer} from "ws";
import {toBool, toHump, toLine, transformObj, uuid} from "@/utils";
import {Database} from "@/db";
import {App} from "@/server/app";
import {rmSync} from "fs";
import {genDmMessageId, genGroupMessageId} from "icqq/lib/message";

export class V12 extends EventEmitter implements OneBot.Base {
    public version = 'V12'
    public action: Action
    protected timestamp = Date.now()
    protected heartbeat?: NodeJS.Timeout
    logger: Logger
    private path: string
    wss?: WebSocketServer
    wsr: Set<WebSocket> = new Set<WebSocket>()
    private db: Database<{ eventBuffer: V12.Payload<keyof Action>[],msgIdMap:Record<string, number>, files: Record<string, V12.FileInfo> }>

    constructor(public oneBot: OneBot<'V12'>, public client: Client, public config: V12.Config) {
        super()
        this.db = new Database(join(App.configDir, 'data', this.oneBot.uin + '.json'))
        this.db.sync({eventBuffer: [],msgIdMap:{}, files: {}})
        this.action = new Action()
        this.logger = this.oneBot.app.getLogger(this.oneBot.uin, this.version)
    }

    get history(): V12.Payload<keyof Action>[] {
        return this.db.get('eventBuffer')
    }

    getFile(file_id: string) {
        return this.db.get(`files.${file_id}`)
    }

    delFile(file_id: string) {
        const files = this.db.get(`files`)
        return delete files[file_id]
    }

    saveFile(fileInfo: V12.FileInfo) {
        const file_id = uuid()
        this.db.set(`files.${file_id}`, fileInfo)
        return file_id
    }

    get files(): ({ file_id: string } & V12.FileInfo)[] {
        const files = this.db.get('files')
        return Object.keys(files).map((file_id) => {
            return {
                file_id,
                ...files[file_id]
            }
        })
    }

    set history(value: any[]) {
        this.db.set('eventBuffer', value)
    }

    start(path?: string) {
        this.path = `/${this.oneBot.uin}`
        if (path) this.path += path
        if (this.config.use_http) {
            const config: V12.HttpConfig = typeof this.config.use_http === 'boolean' ? {} : this.config.use_http || {}
            this.startHttp({
                access_token: this.config.access_token,
                event_enabled: true,
                event_buffer_size: 10,
                ...config
            })
        }
        if (this.config.use_ws) {
            const config: V12.WsConfig = typeof this.config.use_ws === 'boolean' ? {} : this.config.use_ws || {}
            this.startWs({
                access_token: this.config.access_token,
                ...config
            })
        }
        this.config.webhook.forEach(config => {
            if (typeof config === 'string') {
                config = {
                    url: config,
                    access_token: this.config.access_token,
                }
            } else {
                config = {
                    access_token: this.config.access_token,
                    ...config
                }
            }
            this.startWebhook(config)
        })
        this.config.ws_reverse.forEach(config => {
            if (typeof config === 'string') {
                config = {
                    url: config,
                    access_token: this.config.access_token,
                }
            } else {
                config = {
                    access_token: this.config.access_token,
                    ...config
                }
            }
            this.startWsReverse(config)
        })

        if (this.config.heartbeat) {
            this.heartbeat = setInterval(() => {
                this.dispatch(V12.formatPayload(this.oneBot.uin, 'heartbeat', {
                    detail_type: "heartbeat",
                    interval: new Date().getTime() + this.config.heartbeat * 1000,
                    status: this.action.getStatus.apply(this)
                }))
            }, this.config.heartbeat * 1000)
        }
    }

    private startHttp(config: V12.HttpConfig) {
        this.oneBot.app.router.all(this.path,(ctx)=>this.httpRequestHandler(ctx,config))
        this.oneBot.app.router.all(new RegExp(`^${this.path}/(.*)$`), (ctx) => this._httpRequestHandler(ctx, config))
        this.logger.mark(`开启http服务器成功，监听:http://127.0.0.1:${this.oneBot.app.config.port}${this.path}`)
        this.on('dispatch', (payload: V12.Payload<keyof Action>) => {
            if (!['message', 'notice', 'request', 'meta'].includes(payload.type)) return
            if (config.event_enabled) {
                this.history.push(payload)
                if (config.event_buffer_size !== 0 && this.history.length > config.event_buffer_size) this.history.shift()
            }
        })
    }

    private startWebhook(config: V12.WebhookConfig) {
        const options: http.RequestOptions = {
            method: "POST",
            timeout: config.timeout || this.config.request_timeout,
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "OneBot/12 (qq) Node-onebots/" + version,
                "X-OneBot-Version": 12,
                "X-Impl": "onebots",

            },
        }
        if (config.access_token) {
            options.headers['Authorization'] = `Bearer ${config.access_token}`
        }
        const protocol = config.url.startsWith("https") ? https : http
        this.on('dispatch', (unserialized: any) => {
            try {
                const serialized = JSON.stringify(unserialized)
                protocol.request(config.url, {
                    ...options,
                    headers: {
                        ...options.headers,
                        "Content-Length": Buffer.byteLength(serialized),
                    }
                }, (res) => {
                    if (res.statusCode !== 200)
                        return this.logger.warn(`Webhook(${config.url})上报事件收到非200响应：` + res.statusCode)
                    let data = ""
                    res.setEncoding("utf-8")
                    res.on("data", (chunk) => data += chunk)
                    res.on("end", () => {
                        this.logger.debug(`收到Webhook响应 ${res.statusCode} ：` + data)
                        if (!data)
                            return
                        try {
                            this._quickOperate(unserialized, JSON.parse(data))
                        } catch (e) {
                            this.logger.error(`快速操作遇到错误：` + e.message)
                        }
                    })
                }).on("error", (err) => {
                    this.logger.error(`Webhook(${config.url})上报事件失败：` + err.message)
                }).end(serialized, () => {
                    this.logger.debug(`Webhook(${config.url})上报事件成功: ` + serialized)
                })
            } catch (e) {
                this.logger.error(`Webhook(${config.url})上报失败：` + e.message)
            }
        })
        if (config.get_latest_actions) {
            const interval = (config.get_latest_actions && typeof config.get_latest_actions === 'object') ?
                config.get_latest_actions.interval * 1000 :
                1000 * 60
            setInterval(() => {
                try {
                    const actionPath = typeof config.get_latest_actions === 'string' ?
                        config.get_latest_actions :
                        typeof config.get_latest_actions === 'boolean' ?
                            'get_latest_actions' :
                            config.get_latest_actions.path || '/get_latest_actions'
                    protocol.request(`${config.url}${actionPath}`, {
                        ...options,
                        method: 'GET',
                        headers: {
                            ...options.headers,
                        }
                    }, (res) => {
                        if (res.statusCode !== 200)
                            return this.logger.warn(`Webhook(${config.url})获取动作队列收到非200响应：` + res.statusCode)
                        let data = ""
                        res.setEncoding("utf-8")
                        res.on("data", (chunk) => data += chunk)
                        res.on("end", () => {
                            this.logger.info(`获取动作队列响应 ${res.statusCode} ：` + data)
                            if (!data)
                                return
                            try {
                                this.runActions(JSON.parse(data))
                            } catch (e) {
                                this.logger.error(`执行动作报错：` + e.message)
                            }
                        })
                    }).on("error", (err) => {
                        this.logger.error(`Webhook(${config.url})获取动作队列失败：` + err.message)
                    }).end()
                } catch (e) {
                    this.logger.error(`Webhook(${config.url})获取动作队列失败：` + e.message)
                }
            }, interval)
        }
    }

    private runActions(actions: V12.RequestAction[]) {
        for (const action of actions) {
            this.apply(action)
        }
    }

    private startWs(config: V12.WsConfig) {
        this.wss = this.oneBot.app.router.ws(this.path, this.oneBot.app.httpServer)
        this.logger.mark(`开启ws服务器成功，监听:ws://127.0.0.1:${this.oneBot.app.config.port}${this.path}`)
        this.wss.on("error", (err) => {
            this.logger.error(err.message)
        })
        this.wss.on("connection", (ws, req) => {
            this.logger.info(`ws客户端(${req.url})已连接`)
            ws.on("error", (err) => {
                this.logger.error(`ws客户端(${req.url})报错：${err.message}`)
            })
            ws.on("close", (code, reason) => {
                this.logger.warn(`ws客户端(${req.url})连接关闭，关闭码${code}，关闭理由：` + reason)
            })
            if (config.access_token) {
                const url = new URL(req.url, "http://127.0.0.1")
                const token = url.searchParams.get('access_token')
                if (token) req.headers["authorization"] = `Bearer ${token}`
                if (!req.headers["authorization"] || req.headers["authorization"] !== `Bearer ${config.access_token}`)
                    return ws.close(401, "wrong access token")
            }
            this._webSocketHandler(ws)
        })
        this.on('dispatch', (unserialized) => {
            const serialized = JSON.stringify(unserialized)
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

    private startWsReverse(config: V12.WsReverseConfig) {
        this._createWsr(config.url, config)
        this.on('dispatch', (unserialized) => {
            const serialized = JSON.stringify(unserialized)
            for (const ws of this.wsr) {
                ws.send(serialized, (err) => {
                    if (err)
                        this.logger.error(`反向WS(${ws.url})上报事件失败: ` + err.message)
                    else
                        this.logger.debug(`反向WS(${ws.url})上报事件成功: ` + serialized)
                })
            }
        })
    }

    async stop(force?: boolean) {
        if (this.client.status === OnlineStatus.Online) {
            await this.client.terminate()
        }
        this.wss.close()
        for (const ws of this.wsr) {
            ws.close()
        }

        if (force) {
            rmSync(this.client.dir, {force: true, recursive: true})
        }
    }

    format<E extends keyof V12.BotEventMap>(event: E, ...args: [V12.BotEventMap[E]]) {
        const data: Record<string, any> = (typeof args[0]) === 'object' ? args.shift() || {} : {} as any
        data.type = data.post_type
        if (!data.type) {
            data.type = 'meta'
            data.detail_type = 'online'
            if (data.image) {
                data.type = 'login'
                data.detail_type = 'qrcode'
            } else if (data.url) {
                data.type = 'login'
                data.detail_type = 'slider'
                if (data.phone) {
                    data.detail_type = 'device'
                }
            } else if (data.message) {
                data.type = 'login'
                data.detial_type = 'error'
            }
        }
        if (data.type === 'notice') {
            switch (data.detail_type) {
                case 'friend':
                    if (['increase', 'decrease'].includes(data.sub_type)) data.detail_type = 'friend_' + data.sub_type
                    else if (data.sub_type === 'recall') data.detail_type = 'private_message_delete'
                    break;
                case 'group':
                    if (['increase', 'decrease'].includes(data.sub_type)) data.detail_type = 'group_member_' + data.sub_type
                    else if (data.sub_type === 'recall') data.detail_type = 'group_message_delete'
            }
        }
        if (data.type === 'system') data.type = 'meta'
        data.alt_message = data.raw_message
        data.self = this.action.getSelfInfo.apply(this)
        if (!data.detail_type) data.detail_type = data.message_type || data.notice_type || data.request_type || data.system_type
        data.message = data.type === 'message' ? V12.toSegment(data.message) : data.message
        if (data.source) data.source = {
            ...data.source,
            message_id: data.detail_type === 'private' ?
                genDmMessageId(data.source.user_id, data.source.seq, data.source.rand, data.source.time) :
                genGroupMessageId(data.group_id, data.source.user_id, data.source.seq, data.source.rand, data.source.time),
            user_id: data.source.user_id,
            message: data.source.message,
        }
        return V12.formatPayload(this.oneBot.uin, event, data as any)
    }

    system_online(data){

    }

    async dispatch(data: Record<string, any>) {
        const payload: V12.Payload<any> = {
            id: uuid(),
            impl: 'onebots',
            version: 12,
            platform: 'qq',
            self: {
                platform: 'qq',
                user_id: `${this.oneBot.uin}`
            },
            ...transformObj(data, (key, value) => {
                if (!['user_id', 'group_id', 'discuss_id', 'member_id', 'channel_id', 'guild_id'].includes(key)) return value
                return value + ''
            }),
        } as V12.Payload<any>
        this.emit('dispatch', payload)
    }

    async apply(req: V12.RequestAction) {
        let {action, params, echo} = req
        action = toLine(action)
        let is_async = action.includes("_async")
        if (is_async)
            action = action.replace("_async", "")
        if (action === 'send_message') {
            if (["private", "group", "discuss", 'channel'].includes(params.detail_type)) {
                action = "send_" + params.detail_type + "_msg"
            } else if (params.user_id)
                action = "send_private_Msg"
            else if (params.group_id)
                action = "send_group_msg"
            else if (params.discuss_id)
                action = "send_discuss_msg"
            else if (params.channel_id && params.guild_id)
                action = "send_guild_msg"
            else throw new Error('required detail_type or input (user_id/group_id/(guild_id and channel_id))')
        }
        const method = toHump(action) as keyof Action
        if (Reflect.has(this.action, method)) {
            const ARGS = String(Reflect.get(this.action, method)).match(/\(.*\)/)?.[0]
                .replace("(", "")
                .replace(")", "")
                .split(",")
                .filter(Boolean).map(v => v.replace(/=.+/, "").trim())
            const args = []
            for (let k of ARGS) {
                if (Reflect.has(params, k)) {
                    if (BOOLS.includes(k))
                        params[k] = toBool(params[k])
                    args.push(params[k])
                }
            }
            let ret: any, result: any
            try {
                console.log(method, args)
                ret = this.action[method].apply(this, args)
            } catch (e) {
                return JSON.stringify(V12.error(e.message))
            }
            if (ret instanceof Promise) {
                if (is_async) {
                    result = V12.success(null, 0)
                } else {
                    result = V12.success(await ret, 0)
                }
            } else {
                result = V12.success(ret, 0)
            }
            if (result.data instanceof Map)
                result.data = [...result.data.values()]

            if (echo) {
                result.echo = echo
            }
            return JSON.stringify(result)
        } else
            throw new NotFoundError()
    }
    private async httpAuth(ctx:Context,config:V12.HttpConfig){
        if (ctx.method === 'OPTIONS') {
            return ctx.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, authorization'
            }).end()
        }
        const url = new URL(ctx.url, `http://127.0.0.1`)
        if (config.access_token) {
            if (ctx.headers["authorization"]) {
                if (ctx.headers["authorization"] !== `Bearer ${config.access_token}`)
                    return ctx.res.writeHead(403).end()
            } else {
                const access_token = url.searchParams.get("access_token")
                if (!access_token)
                    return ctx.res.writeHead(401).end()
                else if (access_token !== this.config.access_token)
                    return ctx.res.writeHead(403).end()
            }
        }
        ctx.res.setHeader("Content-Type", "application/json; charset=utf-8")
        if (this.config.enable_cors)
            ctx.res.setHeader("Access-Control-Allow-Origin", "*")
    }
    private async httpRequestHandler(ctx:Context,config:V12.HttpConfig){
        if(await this.httpAuth(ctx,config)) return
        if (ctx.method === "GET") {
            try {
                const ret = await this.apply(ctx.query as unknown as V12.RequestAction)
                ctx.res.writeHead(200).end(ret)
            } catch (e) {
                ctx.res.writeHead(500).end(e.message)
            }
        } else if (ctx.method === "POST") {
            try {
                const params = {...(ctx.request.query || {}), ...(ctx.request.body as object || {})}
                const ret = await this.apply(params as unknown as V12.RequestAction)
                ctx.res.writeHead(200).end(ret)
            } catch (e) {
                ctx.res.writeHead(500).end(e.message)
            }
        } else {
            ctx.res.writeHead(405).end()
        }
    }
    private async _httpRequestHandler(ctx: Context, config: V12.HttpConfig) {
        if(await this.httpAuth(ctx,config)) return
        const url = new URL(ctx.url, `http://127.0.0.1`)
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
                const params = {...(ctx.request.query || {}), ...(ctx.request.body as object || {})}
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
                this.action[action].apply(this, [id, res.reply])
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
    protected _createWsr(url: string, config: V12.WsReverseConfig) {
        const timestmap = Date.now()
        const headers: http.OutgoingHttpHeaders = {
            "X-Self-ID": String(this.oneBot.uin),
            "X-Client-Role": "Universal",
            "User-Agent": "OneBot/12 (qq) Node-onebots/" + version,
            "Sec-WebSocket-Protocol": "12.onebots.v" + version
        }
        if (config.access_token)
            headers.Authorization = "Bearer " + config.access_token
        const ws = new WebSocket(url, '12.onebots.v' + version, {headers})
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
            }, this.config.reconnect_interval * 1000)
        })
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
                    this.logger.debug(e)
                    message = e?.message||"请求格式错误"
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
        this.dispatch(V12.formatPayload(this.oneBot.uin, "connect", {
            detail_type: "connect",
            type: 'meta',
            version: this.action.getVersion.apply(this)
        }))
        this.dispatch(V12.formatPayload(this.oneBot.uin, "status_update", {
            detail_type: 'status_update',
            status: this.action.getStatus.apply(this)
        }))
    }

}

export namespace V12 {
    const fileTypes: string[] = ['image', "file", 'record', 'video', 'flash']
    export type Sendable = string | SegmentElem | (string | SegmentElem)[]

    export function fromSegment(msgList: Sendable[]) {
        msgList = [].concat(msgList);
        return msgList.map((msg) => {
            if (typeof msg !== 'object') msg = String(msg)
            if (typeof msg === 'string') {
                return {type: 'text', text: msg} as MessageElem
            }
            const {type, data = {}, ...other} = msg as SegmentElem;
            Object.assign(data, other)
            if (type === 'music' && !data['platform']) {
                data['platform'] = data['type']
                delete data['type']
            }
            if (type === 'mention') data['qq'] = Number(data['user_id'])
            if (fileTypes.includes(type) && !data['file']) {
                data['file'] = data['file_id']
                delete data['file_id']
            }
            return {
                type: type.replace('mention', 'at').replace('at_all', 'at'),
                ...other,
                ...data
            } as MessageElem
        })
    }

    export function toSegment(msgList: IcqqCanSend) {
        msgList = [].concat(msgList);
        return msgList.map((msg) => {
            if (typeof msg === 'string') return {type: 'text', data: {text: msg}} as SegmentElem
            let {type, ...other} = msg;
            if (fileTypes.includes(type)) other['file_id'] = other['file']
            return {
                type: type === 'at' ? other['qq'] ? 'mention' : "mention_all" : type,
                data: {
                    ...other,
                    user_id: other['qq']
                }
            } as SegmentElem
        })
    }

    export interface SegmentMap {
        face: { id: number, text?: string }
        text: { text: string }
        mention: { user_id: string }
        rps: { id?: string }
        dice: { id?: string }
        poke: { user_id: string }
        mention_all: null
        image: { file_id: string }
        voice: { file_id: string }
        audio: { file_id: string }
        file: { file_id: string }
        music: {
            type: "163" | 'qq' | 'xm' | 'custom',
            id?: string,
            url?: string,
            audio?: string,
            title?: string
        }
        location: {
            latitude: number
            longitude: number
            title?: string
            content?: string
        }
        share: {
            url: string
            title: string
            content?: string
            image?: string
        }
        reply: {
            message_id: string
        }
        node: {
            user_id: string
            time?: number
            user_name?: string
            message: SegmentElem[]
        }
        forward: { nodes: SegmentElem<'node'>[] }
    }

    export type SegmentElem<K extends keyof SegmentMap = keyof SegmentMap> = {
        type: K
        data: SegmentMap[K]
    }

    export interface Config {
        heartbeat?: number
        access_token?: string
        request_timeout?: number
        reconnect_interval?: number
        enable_cors?: boolean
        enable_reissue?: boolean
        use_http?: boolean | HttpConfig
        webhook?: (string | WebhookConfig)[]
        use_ws?: boolean | WsConfig
        ws_reverse?: (string | WsReverseConfig)[]
    }

    export interface HttpConfig extends Config.AuthInfo, Config.EventBufferConfig {
    }

    export interface WebhookConfig extends Config.AuthInfo {
        url: string
        timeout?: number
        get_latest_actions?: boolean | string | {
            path?: string
            interval: number
        }
    }

    export interface WsConfig extends Config.AuthInfo {
    }

    export interface WsReverseConfig extends Config.AuthInfo {
        url: string
    }

    export interface Result<T extends any> {
        status: 'ok' | 'failed'
        retcode: 0 | 10001 | 10002 | 10003 | 10004 | 10005 | 10006 | 10007
        data: T
        message: string
        echo?: string
    }

    export const defaultConfig: Config = {
        heartbeat: 3,
        access_token: '',
        request_timeout: 15,
        reconnect_interval: 3,
        enable_cors: true,
        enable_reissue: false,
        use_http: true,
        use_ws: true,
        webhook: [],
        ws_reverse: []
    }
    export type Payload<T extends any> = {
        id: string
        impl: 'onebots'
        version: 12
        platform: 'qq'
        self: {
            platform: 'qq',
            user_id: `${number}`
        }
        time: number
        type: 'meta' | 'message' | 'notice' | 'request'
        detail_type: string
        sub_type: string
    } & T

    export interface Protocol {
        action: string,
        params: any
        echo?: string
    }

    export type BotEventMap = {
        system: Record<string, any>
        connect: {
            type
            detail_type: 'connect'
            version: ReturnType<Action['getVersion']>
        },
        heartbeat: {
            detail_type: 'heartbeat'
            status: ReturnType<Action['getStatus']>
            interval: number
        },
        status_update: {
            detail_type: 'status_update',
            status: ReturnType<Action['getStatus']>
        }
    } & TransformEventMap
    export type TransformEventMap = {
        [P in keyof EventMap]: TransformEventParams<Parameters<EventMap[P]>>
    }
    export type TransformEventParams<T extends any[]> = T extends [infer L, ...infer R] ? L extends object ? L & {
        args: R
    } : { args: [L, ...R] } : { args: T }

    export function success<T extends any>(data: T, retcode: Result<T>['retcode'] = 0, echo?: string): Result<T> {
        return {
            retcode,
            status: retcode === 0 ? 'ok' : 'failed',
            data,
            message: '',
            echo
        }
    }

    export function error(message: string, retcode: Result<null>['retcode'] = 10001, echo?: string): Result<null> {
        return {
            retcode,
            status: 'failed',
            data: null,
            message,
            echo
        }
    }

    export function formatPayload<K extends keyof BotEventMap>(uin: number, type: K, data: Omit<BotEventMap[K], K>) {
        return {
            self_id: uin+'',
            time: Math.floor(Date.now() / 1000),
            detail_type: type,
            type: 'meta',
            sub_type: '',
            ...data,
            group:data['group']?.info,
            friend:data['friend']?.info,
            member:data['member']?.info,
        }
    }

    export type RequestAction = {
        action: string,
        params: Record<string, any>
        echo?: number
    }
    export type FileInfo = {
        type: 'url' | 'path' | 'data'
        name: string
        url?: string
        headers?: Record<string, any>
        path?: string
        data?: string
        sha256?: string
        total_size?: number
    }
}
