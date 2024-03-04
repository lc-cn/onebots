import { Config } from "./config";
import { Action } from "./action";
import { OneBot, OneBotStatus } from "@/onebot";
import { Logger } from "log4js";
import crypto from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import { Dispose } from "@/types";
import { Context } from "koa";
import { URL } from "url";
import { toBool, toHump, toLine, randomInt } from "@/utils";
import { BOOLS, NotFoundError } from "@/onebot";
import http from "http";
import https from "https";
import { join } from "path";
import { App } from "@/server/app";
import { MsgEntry } from "./db_entities";
import { Service } from "@/service";
import { Dict } from "@zhinjs/shared";
import { JsonDB } from "@/db";

const sendMsgTypes = ["private", "group", "discuss"];

export class V11 extends Service<"V11"> implements OneBot.Base {
    public action: Action;
    public version: OneBot.Version = "V11";
    protected timestamp = Date.now();
    protected heartbeat?: NodeJS.Timeout;
    db: JsonDB;
    disposes: Dispose[];
    protected _queue: Array<{ method: keyof Action; args: any[] }> = [];
    protected queue_running: boolean = false;
    logger: Logger;
    wss?: WebSocketServer;
    wsr: Set<WebSocket> = new Set<WebSocket>();

    constructor(
        public oneBot: OneBot,
        public config: OneBot.Config<"V11">,
    ) {
        super(oneBot.adapter, config);
        this.action = new Action();
        this.logger = this.oneBot.adapter.getLogger(this.oneBot.uin, this.version);
        this.db = new JsonDB(join(App.configDir, "data", `${this.oneBot.uin}_v11.jsondb`));
        this.oneBot.on("online", async () => {
            this.logger.info("【好友列表】");
            const friendList = await this.oneBot.getFriendList("V11");
            friendList.forEach(item => this.logger.info(`\t${item.user_name}(${item.user_id})`));
            this.logger.info("【群列表】");
            const groupList = await this.oneBot.getGroupList("V11");
            groupList.forEach(item => this.logger.info(`\t${item.group_name}(${item.group_id})`));
            this.logger.info("");
        });
    }
    transformToInt(path: string, value: string): number {
        if (!value || typeof value !== "string") throw new Error(`value must be string`);
        value = value.replace(/\./g, "%46");
        const obj = this.db.get<Dict<number>>(path, {});
        if (obj[value]) return obj[value];
        const int = randomInt(1000, Number.MAX_SAFE_INTEGER);
        const isExist = () => {
            return Object.keys(obj).some(key => {
                return obj[key] === int;
            });
        };
        // 虽然重复概率小，但还是避免下
        if (isExist()) return this.transformToInt(path, value);
        this.db.set(`${path}.${value}`, int);
        const keys = Object.keys(obj);
        if (keys.length > 1000) this.db.delete(`${path}.${keys.shift()}`);
        return int;
    }
    transformStrToIntForObj<T extends object>(obj: T, keys: (keyof T)[]) {
        if (!obj) return;
        for (const key of keys) {
            const value = obj[key];
            if (typeof value !== "string") continue;
            Reflect.set(obj, key, this.transformToInt(key as string, value));
        }
    }
    getStrByInt(path: string, value: number) {
        const obj = this.db.get<Dict<number>>(path, {});
        return (
            Object.keys(obj)
                .find(str => {
                    return obj[str] == value;
                })
                ?.replace(/%46/g, ".") || value + ""
        );
    }
    start() {
        if (this.config.use_http) this.startHttp();
        if (this.config.use_ws) this.startWs();
        this.config.http_reverse.forEach(config => {
            if (typeof config === "string") {
                config = {
                    url: config,
                    access_token: this.config.access_token,
                    secret: this.config.secret,
                };
            } else {
                config = {
                    access_token: this.config.access_token,
                    secret: this.config.secret,
                    ...config,
                };
            }
            this.startHttpReverse(config);
        });
        this.config.ws_reverse.forEach(config => {
            this.startWsReverse(config);
        });

        this.on("dispatch", serialized => {
            for (const ws of this.wss?.clients || []) {
                ws.send(serialized, err => {
                    if (err) this.logger.error(`正向WS(${ws.url})上报事件失败: ` + err.message);
                    else this.logger.debug(`正向WS(${ws.url})上报事件成功: ` + serialized);
                });
            }
            for (const ws of this.wsr) {
                ws.send(serialized, err => {
                    if (err) {
                        this.logger.error(`反向WS(${ws.url})上报事件失败: ` + err.message);
                    } else this.logger.debug(`反向WS(${ws.url})上报事件成功: ` + serialized);
                });
            }
        });
        if (this.config.heartbeat) {
            this.heartbeat = setInterval(() => {
                this.dispatch({
                    self_id: this.oneBot.uin,
                    status: {
                        online:
                            this.adapter.getSelfInfo(this.oneBot.uin, "V11").status ===
                            OneBotStatus.Online,
                        good: this.oneBot.status === OneBotStatus.Good,
                    },
                    time: Math.floor(Date.now() / 1000),
                    post_type: "meta_event",
                    meta_event_type: "heartbeat",
                    interval: this.config.heartbeat * 1000,
                });
            }, this.config.heartbeat * 1000);
        }
        this.adapter.on("message.receive", (uin: string, event) => {
            const payload = this.adapter.formatEventPayload(uin, "V11", "message", event);
            this.dispatch(payload);
        });
        this.adapter.on("notice.receive", (uin: string, event) => {
            const payload = this.adapter.formatEventPayload(uin, "V11", "notice", event);
            this.dispatch(payload);
        });
        this.adapter.on("request.receive", (uin: string, event) => {
            const payload = this.adapter.formatEventPayload(uin, "V11", "request", event);
            this.dispatch(payload);
        });
    }

    private startHttp() {
        this.oneBot.app.router.all(
            new RegExp(`^${this.path}/(.*)$`),
            this._httpRequestHandler.bind(this),
        );
        this.logger.mark(
            `开启http服务器成功，监听:http://127.0.0.1:${this.oneBot.app.config.port}${this.path}`,
        );
    }

    private startHttpReverse(config: Config.HttpReverseConfig) {
        this.on("dispatch", (serialized: any) => {
            const options: http.RequestOptions = {
                method: "POST",
                timeout: this.config.post_timeout * 1000,
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(serialized),
                    "X-Self-ID": String(this.oneBot.uin),
                    "User-Agent": "OneBot",
                },
            };
            if (this.config.secret) {
                //@ts-ignore
                options.headers["X-Signature"] =
                    "sha1=" +
                    crypto
                        .createHmac("sha1", String(this.config.secret))
                        .update(serialized)
                        .digest("hex");
            }
            const protocol = config.url.startsWith("https") ? https : http;
            try {
                protocol
                    .request(config.url, options, res => {
                        if (res.statusCode !== 200)
                            return this.logger.warn(
                                `POST(${config.url})上报事件收到非200响应：` + res.statusCode,
                            );
                        let data = "";
                        res.setEncoding("utf-8");
                        res.on("data", chunk => (data += chunk));
                        res.on("end", () => {
                            this.logger.debug(`收到HTTP响应 ${res.statusCode} ：` + data);
                            if (!data) return;
                            try {
                                this._quickOperate(JSON.parse(serialized), JSON.parse(data));
                            } catch (e) {
                                this.logger.error(`快速操作遇到错误：` + e.message);
                            }
                        });
                    })
                    .on("error", err => {
                        this.logger.error(`POST(${config.url})上报事件失败：` + err.message);
                    })
                    .end(serialized, () => {
                        this.logger.debug(`POST(${config.url})上报事件成功: ` + serialized);
                    });
            } catch (e) {
                this.logger.error(`POST(${config.url})上报失败：` + e.message);
            }
        });
    }

    private startWs() {
        this.wss = this.oneBot.app.router.ws(this.path, this.oneBot.app.httpServer);
        this.logger.mark(
            `开启ws服务器成功，监听:ws://127.0.0.1:${this.oneBot.app.config.port}${this.path}`,
        );
        this.wss.on("error", err => {
            this.logger.error(err.message);
        });
        this.wss.on("connection", (ws, req) => {
            this.logger.info(`ws客户端(${req.url})已连接`);
            ws.on("error", err => {
                this.logger.error(`ws客户端(${req.url})报错：${err.message}`);
            });
            ws.on("close", (code, reason) => {
                this.logger.warn(
                    `ws客户端(${req.url})连接关闭，关闭码${code}，关闭理由：` + reason,
                );
            });
            if (this.config.access_token) {
                const url = new URL(req.url, "http://127.0.0.1");
                const token = url.searchParams.get("access_token");
                if (token) req.headers["authorization"] = `Bearer ${token}`;
                if (
                    !req.headers["authorization"] ||
                    req.headers["authorization"] !== `Bearer ${this.config.access_token}`
                )
                    return ws.close(1002, "wrong access token");
            }
            this._webSocketHandler(ws);
        });
    }

    private startWsReverse(url: string) {
        this._createWsr(url);
    }

    async stop(force?: boolean) {
        for (const ws of this.wss.clients) {
            ws.close();
        }
        this.wss.close();
        for (const ws of this.wsr) {
            ws.close();
        }
    }

    format(_, data: any) {
        return data;
    }

    async dispatch(data: any) {
        if (!this.filterFn(data)) return;
        data.post_type = data.post_type || "system";
        if (data.message && data.post_type === "message") {
            data.message = this.adapter.transformMessage(this.oneBot.uin, "V11", data.message);
        }
        data.time = Math.floor(Date.now() / 1000);
        // data = transformObj(data, (key, value) => {
        //     if (!['user_id', 'group_id', 'discuss_id', 'member_id', 'channel_id', 'guild_id'].includes(key)) return value
        //     return value + ''
        // })
        if (!this.filterFn(data)) return;
        this.emit("dispatch", this._formatEvent(data));
    }

    private _formatEvent(data: Dict) {
        if (data.post_type === "notice") {
            const data1: any = { ...data };
            if (data.notice_type === "group") {
                delete data1.group;
                delete data1.member;
                switch (data.sub_type) {
                    case "decrease":
                        data1.sub_type =
                            data.operator_id === data.user_id
                                ? "leave"
                                : data.user_id === this.oneBot.uin
                                  ? "kick_me"
                                  : "kick";
                        data1.notice_type = `${data.notice_type}_${data.sub_type}`;
                        break;
                    case "increase":
                        data1.notice_type = `${data.notice_type}_${data.sub_type}`;
                        data1.sub_type = "approve"; // todo 尚未实现
                        data1.operator_id = data1.user_id; // todo 尚未实现
                        break;
                    case "ban":
                        data1.notice_type = `${data.notice_type}_${data.sub_type}`;
                        data1.subtype = data.duration ? "ban" : "lift_ban";
                        break;
                    case "recall":
                        data1.notice_type = `${data.notice_type}_${data.sub_type}`;
                        delete data1.sub_type;
                        break;
                    case "admin":
                        data1.notice_type = `${data.notice_type}_${data.sub_type}`;
                        data1.sub_type = data.set ? "set" : "unset";
                        break;
                    case "poke":
                        data1.notice_type = "notify";
                        data1.user_id = data.operator_id;
                        break;
                    default:
                        break;
                }
            } else {
                delete data1.friend;
                switch (data.sub_type) {
                    case "increase":
                        data1.notice_type = `friend_add`;
                        break;
                    case "recall":
                        data1.notice_type = `friend_recall`;
                        break;
                    default:
                        break;
                }
            }
            return JSON.stringify(data1);
        } else {
            delete data.bot;
            return JSON.stringify(data);
        }
    }

    private async getReplyMsgIdFromDB(data: any): Promise<number> {
        let group_id = data.message_type === "group" ? data.group_id : 0;
        let msg = await this.db.find<MsgEntry>("messages", message => {
            return (
                message.user_id === data.user_id &&
                message.group_id === group_id &&
                message.seq === data.source.seq
            );
        });
        return msg?.id || 0;
    }

    private async _httpRequestHandler(ctx: Context) {
        if (ctx.method === "OPTIONS") {
            return ctx
                .writeHead(200, {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, authorization",
                })
                .end();
        }
        const url = new URL(ctx.url, `http://127.0.0.1`);
        if (this.config.access_token) {
            if (ctx.headers["authorization"]) {
                if (ctx.headers["authorization"] !== `Bearer ${this.config.access_token}`)
                    return ctx.res.writeHead(403).end();
            } else {
                const access_token = url.searchParams.get("access_token");
                if (!access_token) return ctx.res.writeHead(401).end();
                else if (access_token !== this.config.access_token)
                    return ctx.res.writeHead(403).end();
            }
        }
        ctx.res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (this.config.enable_cors) ctx.res.setHeader("Access-Control-Allow-Origin", "*");
        const action = url.pathname.replace(`${this.path}`, "").slice(1);
        if (ctx.method === "GET") {
            try {
                const ret = await this.apply({ action, params: ctx.query });
                ctx.res.writeHead(200).end(ret);
            } catch (e) {
                ctx.res.writeHead(500).end(e.message);
            }
        } else if (ctx.method === "POST") {
            try {
                const params = {
                    ...(ctx.request.query || {}),
                    ...((ctx.request.body as object) || {}),
                };
                const ret = await this.apply({ action, params });
                ctx.res.writeHead(200).end(ret);
            } catch (e) {
                ctx.res.writeHead(500).end(e.message);
            }
        } else {
            ctx.res.writeHead(405).end();
        }
    }

    /**
     * 处理ws消息
     */
    protected _webSocketHandler(ws: WebSocket) {
        ws.on("message", async msg => {
            const msgStr = msg.toString();
            this.logger.info(
                " 收到ws消息：",
                msgStr.length > 2e3
                    ? msgStr.slice(0, 2e3) + ` ... ${msgStr.length - 2e3} more chars`
                    : msgStr,
            );
            var data;
            try {
                data = JSON.parse(msgStr) as V11.Protocol;
                let ret: string;
                if (data.action?.startsWith(".handle_quick_operation")) {
                    const event = data.params.context,
                        res = data.params.operation;
                    this._quickOperate(event, res);
                    ret = JSON.stringify({
                        retcode: 0,
                        status: "async",
                        data: null,
                        error: null,
                        echo: data.echo,
                    });
                } else {
                    ret = await this.apply(data);
                }
                ws.send(ret);
            } catch (e) {
                let code: number, message: string;
                if (e instanceof NotFoundError) {
                    code = 1404;
                    message = "不支持的api";
                } else {
                    code = 1400;
                    message = "请求格式错误";
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
                    }),
                );
            }
        });
        ws.send(JSON.stringify(V11.genMetaEvent(this.oneBot.uin, "connect")));
        ws.send(JSON.stringify(V11.genMetaEvent(this.oneBot.uin, "enable")));
    }

    /**
     * 创建反向ws
     */
    protected _createWsr(url: string) {
        const timestmap = Date.now();
        const headers: http.OutgoingHttpHeaders = {
            "X-Self-ID": String(this.oneBot.uin),
            "X-Client-Role": "Universal",
            "User-Agent": "OneBot",
        };
        if (this.config.access_token) headers.Authorization = "Bearer " + this.config.access_token;
        const ws = new WebSocket(url, { headers });
        ws.on("error", err => {
            this.logger.error(err.message);
        });
        ws.on("open", () => {
            this.logger.info(`反向ws(${url})连接成功。`);
            this.wsr.add(ws);
            this._webSocketHandler(ws);
        });
        ws.on("close", code => {
            this.wsr.delete(ws);
            if (timestmap < this.timestamp) return;
            this.logger.warn(
                `反向ws(${url})被关闭，关闭码${code}，将在${this.config.reconnect_interval}秒后尝试重连。`,
            );
            setTimeout(() => {
                if (timestmap < this.timestamp) return;
                this._createWsr(url);
            }, this.config.reconnect_interval * 1000);
        });
    }

    /**
     * 快速操作
     */
    protected _quickOperate(event: any, res: any) {
        if (event.post_type === "message") {
            if (res.reply) {
                if (event.message_type === "discuss") return;
                const action = event.message_type === "private" ? "sendPrivateMsg" : "sendGroupMsg";
                const id = event.message_type === "private" ? event.user_id : event.group_id;
                if (typeof res.reply === "string") {
                    if (/[CQ:music,type=.+,id=.+]/.test(res.reply)) {
                        res.reply = res.reply.replace(",type=", ",platform=");
                    }
                    res.reply = this.adapter.fromCqcode("V11", res.reply);
                } else {
                    if (res.reply[0].type == "music" && res.reply[0]?.data?.type) {
                        res.reply[0].data.platform = res.reply[0].data.type;
                        delete res.reply[0].data.type;
                    }
                    res.reply = this.adapter.fromSegment(this.oneBot, "V11", res.reply);
                }
                this.action[action].apply(this, [id, res.reply, res.auto_escape]);
            }
            if (event.message_type === "group") {
                if (res.delete)
                    this.adapter.deleteMessage(this.oneBot.uin, "V11", [event.message_id]);
                if (res.kick && !event.anonymous)
                    this.adapter.call(this.oneBot.uin, "V11", "setGroupKick", [
                        event.group_id,
                        event.user_id,
                        res.reject_add_request,
                    ]);
                if (res.ban)
                    this.adapter.call(this.oneBot.uin, "V11", "setGroupBan", [
                        event.group_id,
                        event.user_id,
                        res.ban_duration > 0 ? res.ban_duration : 1800,
                    ]);
            }
        }
        if (event.post_type === "request" && "approve" in res) {
            const action =
                event.request_type === "friend" ? "setFriendAddRequest" : "setGroupAddRequest";
            this.adapter.call(this.oneBot.uin, "V11", action, [
                event.flag,
                res.approve,
                res.reason ? res.reason : "",
                !!res.block,
            ]);
        }
    }

    /**
     * 调用api
     */
    async apply(req: V11.Protocol) {
        let { action, params, echo } = req;
        action = toLine(action);

        let is_async = action.includes("_async");
        if (is_async) action = action.replace("_async", "");

        let is_queue = action.includes("_rate_limited");
        if (is_queue) action = action.replace("_rate_limited", "");

        if (action === "send_msg") {
            if (sendMsgTypes.includes(params.message_type))
                action = "send_" + params.message_type + "_msg";
            else if (params.user_id) action = "send_private_msg";
            else if (params.group_id) action = "send_group_msg";
            else throw new Error("required message_type or input (user_id/group_id)");
        }

        const method = toHump(action) as keyof Action;
        if (Reflect.has(this.action, method)) {
            const ARGS = String(Reflect.get(this.action, method))
                .match(/\(.*\)/)?.[0]
                .replace("(", "")
                .replace(")", "")
                .split(",")
                .filter(Boolean)
                .map(v => v.replace(/=.+/, "").trim());
            const args = [];
            for (let k of ARGS) {
                if (Reflect.has(params, k)) {
                    if (BOOLS.includes(k)) params[k] = toBool(params[k]);
                    if (k === "message") {
                        if (typeof params[k] === "string") {
                            if (/[CQ:music,type=.+,id=.+]/.test(params[k])) {
                                params[k] = params[k].replace(",type=", ",platform=");
                            }
                            params[k] = this.adapter.fromCqcode("V11", params[k]);
                        }
                        params[k] = this.adapter.fromSegment(this.oneBot, "V11", params[k]);
                        params["message_id"] =
                            params[k].find(e => e.type === "reply")?.id || params["message_id"];
                    }
                    args.push(params[k]);
                }
            }
            let ret: any, result: any;
            if (is_queue) {
                this._queue.push({ method, args });
                this._runQueue();
                result = V11.ok(null, 0, true);
            } else {
                try {
                    ret = await this.action[method].apply(this, args);
                } catch (e) {
                    this.logger.error(`run ${action} with args:${args.length} failed:`, e);
                    return JSON.stringify(V11.error(e.message));
                }
                if (ret instanceof Promise) {
                    if (is_async) {
                        result = V11.ok(null, 0, true);
                    } else {
                        result = V11.ok(await ret, 0, false);
                    }
                } else {
                    result = V11.ok(await ret, 0, false);
                }
            }
            if (result.data instanceof Map) result.data = [...result.data.values()];
            if (result.data?.message)
                result.data.message = this.adapter.toSegment("V11", result.data.message);
            if (echo) {
                result.echo = echo;
            }
            return JSON.stringify(result);
        }
    }

    /**
     * 限速队列调用
     */
    async _runQueue() {
        if (this.queue_running) return;
        while (this._queue.length > 0) {
            this.queue_running = true;
            const task = this._queue.shift();
            const { method, args } = task as (typeof V11.prototype._queue)[0];
            this.action[method].apply(this, args);
            await new Promise(resolve => {
                setTimeout(resolve, this.config.rate_limit_interval * 1000);
            });
            this.queue_running = false;
        }
    }
}

export namespace V11 {
    export interface Result<T extends any> {
        retcode: number;
        status: "ok" | "async" | "error";
        data: T;
        error: string;
        echo?: string;
    }

    export function ok<T extends any>(data: T, retcode = 0, pending?: boolean): Result<T> {
        return {
            retcode,
            status: pending ? "async" : "ok",
            data,
            error: null,
        };
    }

    export function error(error: string, retcode = 1): Result<any> {
        return {
            retcode,
            status: "error",
            data: null,
            error,
        };
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
        use_ws: true,
        http_reverse: [],
        ws_reverse: [],
    };

    export function genMetaEvent(uin: string, type: string) {
        return {
            self_id: Number.isNaN(parseInt(uin)) ? uin : parseInt(uin),
            time: Math.floor(Date.now() / 1000),
            post_type: "meta_event",
            meta_event_type: "lifecycle",
            sub_type: type,
        };
    }

    export interface Protocol {
        action: string;
        params: any;
        echo?: any;
    }

    export interface Config {
        access_token?: string;
        post_timeout?: number;
        enable_cors?: boolean;
        enable_reissue?: boolean;
        rate_limit_interval?: number;
        post_message_format?: "string" | "array";
        heartbeat?: number;
        secret?: string;
        reconnect_interval?: number;
        use_http?: boolean;
        use_ws?: boolean;
        http_reverse?: (string | Config.HttpReverseConfig)[];
        ws_reverse?: string[];
    }

    export type Payload<T = Dict> = {
        [P in string | symbol]: any;
    } & T;
    export type SelfInfo = {
        status: OneBotStatus;
        nickname: string;
    };

    export interface GroupInfo {
        group_id: number;
        group_name: string;
    }

    export interface UserInfo {
        user_id: number;
        user_name: string;
    }

    export interface GroupMemberInfo {
        group_id: number;
        user_id: number;
        user_name: string;
    }
    export interface Segment {
        type: string;
        data: Dict;
    }
    export type Sendable = string | Segment | (string | Segment)[];
    export interface Message {
        message: Sendable;
    }

    export interface MessageRet {
        message_id: number;
    }
}
