import { BOOLS, NotFoundError, OneBot, OneBotStatus } from "@/onebot"
import { App } from "@/server/app"
import { Service } from "@/service"
import { Dispose } from "@/types"
import { toBool, toHump, toLine } from "@/utils"
import * as crypto from "crypto"
import { rmSync } from "fs"
import http from "http"
import https from "https"
import { Client, EventMap, MessageElem, OnlineStatus } from "icqq"
import { fromCqcode, fromSegment, toCqcode, toSegment } from "icqq-cq-enable"
import { Context } from "koa"
import { Logger } from "log4js"
import { join } from "path"
import { URL } from "url"
import { WebSocket, WebSocketServer } from "ws"
import { Action } from "./action"
import { Config } from "./config"
import { MsgEntry } from "./db_entities"
import { Database } from "./db_sqlite"

const sendMsgTypes = ["private", "group", "discuss"]
const sendMsgMethodRegex = new RegExp(`send_(${sendMsgTypes.join("|")})_msg`)

export class V11 extends Service<"V11"> implements OneBot.Base {
  public action: Action
  public version = "V11"
  protected timestamp = Date.now()
  protected heartbeat?: NodeJS.Timeout
  private path: string
  db: Database
  disposes: Dispose[]
  protected _queue: Array<{
    method: keyof Action
    args: any[]
  }> = []
  protected queue_running: boolean = false
  logger: Logger
  wss?: WebSocketServer
  wsr: Set<WebSocket> = new Set<WebSocket>()
  constructor(public oneBot: OneBot<"V11">, public client: Client, config: OneBot.Config<"V11">) {
    super(config)
    this.action = new Action()
    this.logger = this.oneBot.app.getLogger(this.oneBot.uin, this.version)
    this.db = new Database(join(App.configDir, "data", this.oneBot.uin + ".db"), this.logger)
  }

  start(path?: string) {
    this.path = `/${this.oneBot.uin}`
    if (path) this.path += path
    if (this.config.use_http) this.startHttp()
    if (this.config.use_ws) this.startWs()
    this.config.http_reverse.forEach((config) => {
      if (typeof config === "string") {
        config = {
          url: config,
          access_token: this.config.access_token,
          secret: this.config.secret,
        }
      } else {
        config = {
          access_token: this.config.access_token,
          secret: this.config.secret,
          ...config,
        }
      }
      this.startHttpReverse(config)
    })
    this.config.ws_reverse.forEach((config) => {
      this.startWsReverse(config)
    })

    if (this.config.heartbeat) {
      this.heartbeat = setInterval(() => {
        this.dispatch({
          self_id: this.oneBot.uin,
          status: {
            online: this.client.status === OnlineStatus.Online,
            good: this.oneBot.status === OneBotStatus.Good,
          },
          time: Math.floor(Date.now() / 1000),
          post_type: "meta_event",
          meta_event_type: "heartbeat",
          interval: this.config.heartbeat * 1000,
        })
      }, this.config.heartbeat * 1000)
    }
  }

  private startHttp() {
    this.oneBot.app.router.all(new RegExp(`^${this.path}/(.*)$`), this._httpRequestHandler.bind(this))
    this.logger.mark(`开启http服务器成功，监听:http://127.0.0.1:${this.oneBot.app.config.port}${this.path}`)
  }

  private startHttpReverse(config: Config.HttpReverseConfig) {
    this.on("dispatch", (unserialized: any) => {
      const serialized = JSON.stringify(unserialized)
      const options: http.RequestOptions = {
        method: "POST",
        timeout: this.config.post_timeout * 1000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(serialized),
          "X-Self-ID": String(this.oneBot.uin),
          "User-Agent": "OneBot",
        },
      }
      if (this.config.secret) {
        //@ts-ignore
        options.headers["X-Signature"] =
          "sha1=" + crypto.createHmac("sha1", String(this.config.secret)).update(serialized).digest("hex")
      }
      const protocol = config.url.startsWith("https") ? https : http
      try {
        protocol
          .request(config.url, options, (res) => {
            if (res.statusCode !== 200)
              return this.logger.warn(`POST(${config.url})上报事件收到非200响应：` + res.statusCode)
            let data = ""
            res.setEncoding("utf-8")
            res.on("data", (chunk) => (data += chunk))
            res.on("end", () => {
              this.logger.debug(`收到HTTP响应 ${res.statusCode} ：` + data)
              if (!data) return
              try {
                this._quickOperate(unserialized, JSON.parse(data))
              } catch (e) {
                this.logger.error(`快速操作遇到错误：` + e.message)
              }
            })
          })
          .on("error", (err) => {
            this.logger.error(`POST(${config.url})上报事件失败：` + err.message)
          })
          .end(serialized, () => {
            this.logger.debug(`POST(${config.url})上报事件成功: ` + serialized)
          })
      } catch (e) {
        this.logger.error(`POST(${config.url})上报失败：` + e.message)
      }
    })
  }

  private startWs() {
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
      if (this.config.access_token) {
        const url = new URL(req.url, "http://127.0.0.1")
        const token = url.searchParams.get("access_token")
        if (token) req.headers["authorization"] = `Bearer ${token}`
        if (!req.headers["authorization"] || req.headers["authorization"] !== `Bearer ${this.config.access_token}`)
          return ws.close(1002, "wrong access token")
      }
      this._webSocketHandler(ws)
    })
    this.on("dispatch", (serialized) => {
      for (const ws of this.wss.clients) {
        ws.send(serialized, (err) => {
          if (err) this.logger.error(`正向WS(${ws.url})上报事件失败: ` + err.message)
          else this.logger.debug(`正向WS(${ws.url})上报事件成功: ` + serialized)
        })
      }
    })
  }

  private startWsReverse(url: string) {
    this._createWsr(url)
    this.on("dispatch", (serialized) => {
      for (const ws of this.wsr) {
        ws.send(serialized, (err) => {
          if (err) {
            this.logger.error(`反向WS(${ws.url})上报事件失败: ` + err.message)
          } else this.logger.debug(`反向WS(${ws.url})上报事件成功: ` + serialized)
        })
      }
    })
  }

  async stop(force?: boolean) {
    if (this.client.status === OnlineStatus.Online) {
      await this.client.terminate()
    }
    if (force) {
      rmSync(this.client.dir, { force: true, recursive: true })
    }
  }

  format(_, data: any) {
    return data
  }

  system_online(data) {
    this.logger.info("【好友列表】")
    this.client.fl.forEach((item) => this.logger.info(`\t${item.nickname}(${item.user_id})`))
    this.logger.info("【群列表】")
    this.client.gl.forEach((item) => this.logger.info(`\t${item.group_name}(${item.group_id})`))
    this.logger.info("")
  }

  async dispatch(data: any) {
    data.post_type = data.post_type || "system"
    if (data.message && data.post_type === "message") {
      if (this.config.post_message_format === "array") {
        data.message = toSegment(data.message)
        if (data.source) {
          // reply
          let msg0 = data.message[0]
          msg0.data["id"] = await this.getReplyMsgIdFromDB(data)
        }
      } else {
        if (data.source) {
          data.message.shift()
          // segment 更好用, cq 一般只用来显示，就不存储真实id了, 有需求的自己去改
          data.message = toCqcode(data).replace(/^(\[CQ:reply,id=)(.+?)\]/, `$1${data.source.seq}]`)
        } else {
          data.message = toCqcode(data)
        }
      }
    }

    if (data.message_id) {
      data.message_id = await this.addMsgToDB(data)
    }

    if (data.post_type == "notice" && String(data.notice_type).endsWith("_recall")) {
      this.db.markMsgAsRecalled(data.base64_id)
    }
    if (data.font) {
      const fontNo = Buffer.from(data.font).readUInt32BE()
      // this.db.set(`KVMap.${data.fontNo}`,data.font)
      data.font = fontNo
    }
    data.time = Math.floor(Date.now() / 1000)
    // data = transformObj(data, (key, value) => {
    //     if (!['user_id', 'group_id', 'discuss_id', 'member_id', 'channel_id', 'guild_id'].includes(key)) return value
    //     return value + ''
    // })
    this.emit("dispatch", this._formatEvent(data))
  }

  private _formatEvent(data: Parameters<EventMap["message"] | EventMap["notice"] | EventMap["request"]>[0]) {
    if (data.post_type === "notice") {
      // console.log(JSON.stringify(data))
      const data1: any = { ...data }
      if (data.notice_type === "group") {
        delete data1.group
        delete data1.member
        switch (data.sub_type) {
          case "decrease":
            data1.sub_type =
              data.operator_id === data.user_id ? "leave" : data.user_id === this.client.uin ? "kick_me" : "kick"
            data1.notice_type = `${data.notice_type}_${data.sub_type}`
            break
          case "increase":
            data1.notice_type = `${data.notice_type}_${data.sub_type}`
            data1.sub_type = "approve" // todo 尚未实现
            data1.operator_id = data1.user_id // todo 尚未实现
            break
          case "ban":
            data1.notice_type = `${data.notice_type}_${data.sub_type}`
            data1.subtype = data.duration ? "ban" : "lift_ban"
            break
          case "recall":
            data1.notice_type = `${data.notice_type}_${data.sub_type}`
            delete data1.sub_type
            break
          case "admin":
            data1.notice_type = `${data.notice_type}_${data.sub_type}`
            data1.sub_type = data.set ? "set" : "unset"
            break
          case "poke":
            data1.notice_type = "notify"
            data1.user_id = data.operator_id
            break
          default:
            break
        }
      } else {
        delete data1.friend
        switch (data.sub_type) {
          case "increase":
            data1.notice_type = `friend_add`
            break
          case "recall":
            data1.notice_type = `friend_recall`
            break
          default:
            break
        }
      }
      return JSON.stringify(data1)
    } else {
      return JSON.stringify(data)
    }
  }

  private async addMsgToDB(data: any): Promise<number> {
    if (!data.sender || !("user_id" in data.sender)) {
      // eg. notice
      return
    }
    let msg = new MsgEntry()
    msg.base64_id = data.message_id
    msg.seq = data.seq
    msg.user_id = data.sender.user_id
    msg.nickname = data.sender.nickname
    if (data.message_type === "group") {
      msg.group_id = data.group_id
      msg.group_name = data["group_name"] || "" // 可能不存在(gocq默认不发)
    } else {
      msg.group_id = 0
      msg.group_name = ""
    }
    msg.content = data.cqCode

    return await this.db.addOrUpdateMsg(msg)
  }

  /**
   * 从 send_msg_xxx() 调用的返回值中提取消息存入数据库(可以让前端在没有收到同步的message数据前就有能力拿到消息对应的base64_id)
   * (也有可能来的比message慢，后来的话会被数据库忽略)
   * @param user_id 发送者
   * @param group_id 群号，私聊为0
   * @param seq 消息序号
   * @param base64_id icqq返回的base64格式的消息id
   */
  private async addMsgToDBFromSendMsgResult(
    user_id: number,
    group_id: number,
    seq: number,
    base64_id: string
  ): Promise<number> {
    let msg = new MsgEntry()
    msg.base64_id = base64_id
    msg.seq = seq
    msg.user_id = user_id
    msg.nickname = ""
    msg.group_id = group_id
    msg.group_name = ""
    msg.content = ""

    return await this.db.addOrUpdateMsg(msg)
  }

  private async getReplyMsgIdFromDB(data: any): Promise<number> {
    let group_id = data.message_type === "group" ? data.group_id : 0
    let msg = await this.db.getMsgByParams(data.source.user_id, group_id, data.source.seq)
    return msg ? msg.id : 0
  }

  private async _httpRequestHandler(ctx: Context) {
    if (ctx.method === "OPTIONS") {
      return ctx
        .writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, authorization",
        })
        .end()
    }
    const url = new URL(ctx.url, `http://127.0.0.1`)
    if (this.config.access_token) {
      if (ctx.headers["authorization"]) {
        if (ctx.headers["authorization"] !== `Bearer ${this.config.access_token}`) return ctx.res.writeHead(403).end()
      } else {
        const access_token = url.searchParams.get("access_token")
        if (!access_token) return ctx.res.writeHead(401).end()
        else if (access_token !== this.config.access_token) return ctx.res.writeHead(403).end()
      }
    }
    ctx.res.setHeader("Content-Type", "application/json; charset=utf-8")
    if (this.config.enable_cors) ctx.res.setHeader("Access-Control-Allow-Origin", "*")
    const action = url.pathname.replace(`${this.path}`, "").slice(1)
    if (ctx.method === "GET") {
      try {
        const ret = await this.apply({ action, params: ctx.query })
        ctx.res.writeHead(200).end(ret)
      } catch (e) {
        ctx.res.writeHead(500).end(e.message)
      }
    } else if (ctx.method === "POST") {
      try {
        const params = {
          ...(ctx.request.query || {}),
          ...((ctx.request.body as object) || {}),
        }
        const ret = await this.apply({ action, params })
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
      const msgStr = msg.toString()
      this.logger.info(
        " 收到ws消息：",
        msgStr.length > 2e3 ? msgStr.slice(0, 2e3) + ` ... ${msgStr.length - 2e3} more chars` : msgStr
      )
      var data
      try {
        data = JSON.parse(msgStr) as V11.Protocol
        let ret: string
        if (data.action.startsWith(".handle_quick_operation")) {
          const event = data.params.context,
            res = data.params.operation
          this._quickOperate(event, res)
          ret = JSON.stringify({
            retcode: 0,
            status: "async",
            data: null,
            error: null,
            echo: data.echo,
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
        ws.send(
          JSON.stringify({
            retcode: code,
            status: "failed",
            data: null,
            error: {
              code,
              message,
            },
            echo: data?.echo,
            msg: e.message, // gocq 返回的消息里有这个字段且很多插件都在访问
            action: data.action,
          })
        )
      }
    })
    ws.send(JSON.stringify(V11.genMetaEvent(this.oneBot.uin, "connect")))
    ws.send(JSON.stringify(V11.genMetaEvent(this.oneBot.uin, "enable")))
  }

  /**
   * 创建反向ws
   */
  protected _createWsr(url: string) {
    const timestmap = Date.now()
    const headers: http.OutgoingHttpHeaders = {
      "X-Self-ID": String(this.oneBot.uin),
      "X-Client-Role": "Universal",
      "User-Agent": "OneBot",
    }
    if (this.config.access_token) headers.Authorization = "Bearer " + this.config.access_token
    const ws = new WebSocket(url, { headers })
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
      if (timestmap < this.timestamp) return
      this.logger.warn(`反向ws(${url})被关闭，关闭码${code}，将在${this.config.reconnect_interval}秒后尝试重连。`)
      setTimeout(() => {
        if (timestmap < this.timestamp) return
        this._createWsr(url)
      }, this.config.reconnect_interval * 1000)
    })
  }

  /**
   * 快速操作
   */
  protected _quickOperate(event: any, res: any) {
    if (event.post_type === "message") {
      if (res.reply) {
        if (event.message_type === "discuss") return
        const action = event.message_type === "private" ? "sendPrivateMsg" : "sendGroupMsg"
        const id = event.message_type === "private" ? event.user_id : event.group_id
        this.client[action](id, res.reply, res.auto_escape)
      }
      if (event.message_type === "group") {
        if (res.delete) this.client.deleteMsg(event.message_id)
        if (res.kick && !event.anonymous)
          this.client.setGroupKick(event.group_id, event.user_id, res.reject_add_request)
        if (res.ban)
          this.client.setGroupBan(event.group_id, event.user_id, res.ban_duration > 0 ? res.ban_duration : 1800)
      }
    }
    if (event.post_type === "request" && "approve" in res) {
      const action: keyof Client = event.request_type === "friend" ? "setFriendAddRequest" : "setGroupAddRequest"
      this.client[action](event.flag, res.approve, res.reason ? res.reason : "", !!res.block)
    }
  }

  /**
   * 调用api
   */
  async apply(req: V11.Protocol) {
    let { action, params, echo } = req
    action = toLine(action)

    let is_async = action.includes("_async")
    if (is_async) action = action.replace("_async", "")

    let is_queue = action.includes("_rate_limited")
    if (is_queue) action = action.replace("_rate_limited", "")

    if (action === "send_msg") {
      if (sendMsgTypes.includes(params.message_type)) action = "send_" + params.message_type + "_msg"
      else if (params.user_id) action = "send_private_msg"
      else if (params.group_id) action = "send_group_msg"
      else if (params.discuss_id) action = "send_discuss_msg"
      else throw new Error("required message_type or input (user_id/group_id)")
    } else if (action === "send_like") {
      action = "send_user_like"
    }

    const method = toHump(action) as keyof Action
    if (!Reflect.has(this.action, method)) throw new NotFoundError()

    const processOBMessage = (message: string | any[]): MessageElem[] => {
      if (typeof message === "string") message = fromCqcode(message)
      const [firstSeg] = message
      if (firstSeg.type == "music" && firstSeg?.data?.type) {
        firstSeg.data.platform = firstSeg.data.type
        delete firstSeg.data.type
      }
      return fromSegment(message)
    }

    for (const key of Object.keys(params)) {
      if (BOOLS.includes(key)) params[key] = toBool(params[key])
      else if (key === "message") {
        const message = processOBMessage(params[key])
        const replyFilter = (e: any) => e.type === "reply"
        const replyElem = message.find(replyFilter) as any
        const messageId: number = replyElem?.id ?? replyElem?.message_id
        if (messageId) params.message_id = messageId
        params.message = message.filter((e: any) => !replyFilter(e))
      }
    }
    if (action === "get_msg") params.onebot_id = params.message_id
    if (typeof params.message_id === "number" || /^\d+$/.test(params.message_id)) {
      params.message_id = (await this.db.getMsgById(params.message_id)).base64_id // 调用api时把本地的数字id转为base64发给icqq
    }
    // this.logger.info(`处理过后的请求 params: `, params)

    const orgArgNameList = String(Reflect.get(this.action, method))
      .match(/\(.*\)/)?.[0]
      .replace("(", "")
      .replace(")", "")
      .split(",")
      .filter(Boolean)
      .map((v) => v.replace(/=.+/, "").trim())
    const args = orgArgNameList.map((k) => params[k])
    // this.logger.info(`Action 原参数名列表: `, orgArgNameList)
    // this.logger.info(`处理后的 Action 参数列表: `, args)

    let ret: any, result: V11.Result<any>
    if (is_queue) {
      this._queue.push({ method, args })
      this._runQueue()
      result = V11.ok(null, 0, true)
    } else {
      try {
        ret = await this.action[method].apply(this, args)
      } catch (e) {
        this.logger.error(e)
        const err = V11.error(e.message)
        if (echo) err.echo = echo
        return JSON.stringify(err)
      }
      if (ret instanceof Promise) {
        if (is_async) {
          result = V11.ok(null, 0, true)
        } else {
          result = V11.ok(await ret, 0, false)
        }
      } else {
        result = V11.ok(await ret, 0, false)
      }
    }
    if (result.data instanceof Map) result.data = [...result.data.values()]
    if (result.data?.message) result.data.message = toSegment(result.data.message)

    // send_msg_xxx 时提前把数据写入数据库(也有可能来的比message慢，后来的话会被数据库忽略)
    if (result.status === "ok" && action.match(sendMsgMethodRegex) && result.data?.message_id && result.data?.seq) {
      result.data.message_id = await this.addMsgToDBFromSendMsgResult(
        this.client.uin, // msg send resp uin is always bot uin
        params.group_id || 0,
        result.data.seq,
        result.data.message_id
      )
    }
    if (echo) {
      result.echo = echo
    }
    return JSON.stringify(result)
  }

  /**
   * 限速队列调用
   */
  protected async _runQueue() {
    if (this.queue_running) return
    while (this._queue.length > 0) {
      this.queue_running = true
      const task = this._queue.shift()
      const { method, args } = task as (typeof V11.prototype._queue)[0]
      this.action[method].apply(this, args)
      await new Promise((resolve) => {
        setTimeout(resolve, this.config.rate_limit_interval * 1000)
      })
      this.queue_running = false
    }
  }
}

export namespace V11 {
  export interface Result<T extends any> {
    retcode: number
    status: "ok" | "async" | "error"
    data: T
    error: string
    echo?: string
  }

  export function ok<T extends any>(data: T, retcode = 0, pending?: boolean): Result<T> {
    return {
      retcode,
      status: pending ? "async" : "ok",
      data,
      error: null,
    }
  }

  export function error(error: string, retcode = 1): Result<any> {
    return {
      retcode,
      status: "error",
      data: null,
      error,
    }
  }

  export const defaultConfig: Config = {
    heartbeat: 3,
    access_token: "",
    post_timeout: 15,
    secret: "",
    rate_limit_interval: 4,
    post_message_format: "string",
    reconnect_interval: 3,
    use_http: true,
    enable_cors: true,
    enable_reissue: false,
    use_ws: true,
    http_reverse: [],
    ws_reverse: [],
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
    action: string
    params: any
    echo?: any
  }

  export interface Config {
    access_token?: string
    post_timeout?: number
    enable_cors?: boolean
    enable_reissue?: boolean
    rate_limit_interval?: number
    post_message_format?: "string" | "array"
    heartbeat?: number
    secret?: string
    reconnect_interval?: number
    use_http?: boolean
    use_ws?: boolean
    http_reverse?: (string | Config.HttpReverseConfig)[]
    ws_reverse?: string[]
  }
}
