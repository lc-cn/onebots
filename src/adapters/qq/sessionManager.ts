import axios from "axios";
import { QQBot } from "./qqBot";
import { WebSocket } from "ws";
import { toObject } from "./utils";
import { EventEmitter } from "events";
import { wsResData } from "./types";
import { Intends, OpCode, SessionEvents, WebsocketCloseReason } from "./constans";

export const MAX_RETRY = 10;

export class SessionManager extends EventEmitter {
    public access_token: string;
    public wsUrl: string;
    retry: number = 0;
    alive?: boolean;
    heartbeatInterval: number;
    isReconnect: boolean;
    sessionRecord = {
        sessionID: "",
        seq: 0
    };
    heartbeatParam = {
        op: OpCode.HEARTBEAT,
        d: null // 心跳唯一值
    };

    get token() {
        return this.bot.config.token;
    }

    constructor(private bot: QQBot) {
        super();
        this.on(SessionEvents.EVENT_WS, (data) => {
            switch (data.eventType) {
                case SessionEvents.RECONNECT:
                    this.bot.logger.mark("[CLIENT] 等待断线重连中...");
                    break;
                case SessionEvents.DISCONNECT:
                    if (this.retry < (this.bot.config.maxRetry || MAX_RETRY)) {
                        this.bot.logger.mark("[CLIENT] 重新连接中，尝试次数：", this.retry + 1);
                        if (WebsocketCloseReason.find((v) => v.code === data.code)?.resume) {
                            this.sessionRecord = data.eventMsg;
                        }
                        this.isReconnect = true
                        this.start();
                        this.retry += 1;
                    } else {
                        this.bot.logger.mark("[CLIENT] 超过重试次数，连接终止");
                        this.emit(SessionEvents.DEAD, {
                            eventType: SessionEvents.ERROR,
                            msg: "连接已死亡，请检查网络或重启"
                        });
                    }
                    break;
                case SessionEvents.READY:
                    this.bot.logger.mark("[CLIENT] 连接成功");
                    this.retry = 0;
                    break;
                default:
            }
        });
    }

    async getAccessToken(): Promise<QQBot.Token> {
        let { secret, appid } = this.bot.config;
        const getToken = () => {
            return new Promise<QQBot.Token>((resolve, reject) => {
                axios.post("https://bots.qq.com/app/getAppAccessToken", {
                    appId: appid,
                    clientSecret: secret
                }).then(res => {
                    if (res.status === 200 && res.data && typeof res.data === "object") {
                        resolve(res.data as QQBot.Token);
                    } else {
                        reject(res);
                    }
                });
            });
        };
        const getNext = async (next_time: number) => {
            return new Promise<QQBot.Token>(resolve => {
                setTimeout(async () => {
                    const token = await getToken();
                    this.bot.logger.debug("getAccessToken", token);
                    this.access_token = token.access_token;
                    getNext(token.expires_in - 1).catch(() => getNext(0));
                    resolve(token);
                }, next_time * 1000);
            });
        };
        return getNext(0);
    }

    async getWsUrl() {
        return new Promise<void>((resolve) => {
            this.bot.request.get("/gateway/bot", {
                headers: {
                    Accept: "*/*",
                    "Accept-Encoding": "utf-8",
                    "Accept-Language": "zh-CN,zh;q=0.8",
                    Connection: "keep-alive",
                    "User-Agent": "v1",
                    Authorization: ""
                }
            }).then(res => {
                if (!res.data) throw new Error("获取ws连接信息异常");
                this.wsUrl = res.data.url;
                resolve();
            });
        });
    }

    getValidIntends() {
        return (this.bot.config.intents || []).reduce((result, item) => {
            const value = Intends[item];
            if (value === undefined) {
                this.bot.logger.warn(`Invalid intends(${item}),skip...`);
                return result;
            }
            return Intends[item as keyof Intends] | result;
        }, 0);
    }

    async start() {
        await this.getAccessToken();
        await this.getWsUrl();
        this.connect();
        this.startListen();
    }

    connect() {
        this.bot.ws = new WebSocket(this.wsUrl, {
            headers: {
                "Authorization": "QQBot " + this.access_token,
                "X-Union-Appid": this.bot.config.appid
            }
        });
    }

    reconnectWs() {
        const reconnectParam = {
            op: OpCode.RESUME,
            d: {
                // token: `Bot ${this.bot.appId}${this.token}`,
                token: `QQBot ${this.access_token}`,
                session_id: this.sessionRecord.sessionID,
                seq: this.sessionRecord.seq
            }
        };
        this.sendWs(reconnectParam);
    }

    // 发送websocket
    sendWs(msg: unknown) {
        try {
            // 先将消息转为字符串
            this.bot.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
        } catch (e) {
            this.bot.logger.error(e);
        }
    }

    authWs() {

        // 鉴权参数
        const authOp = {
            op: OpCode.IDENTIFY, // 鉴权参数
            d: {
                // token: `Bot ${this.bot.appId}${this.token}`,
                token: `QQBot ${this.access_token}`, // 根据配置转换token
                intents: this.getValidIntends(), // todo 接受的类型
                shard: [0, 1] // 分片信息,给一个默认值
            }
        };
        // 发送鉴权请求
        this.sendWs(authOp);
    }

    startListen() {
        this.bot.ws.on("close", (code) => {
            this.alive=false
            this.bot.logger.mark(`[CLIENT] 连接关闭：${code}`);
            this.emit(SessionEvents.EVENT_WS, {
                eventType: SessionEvents.DISCONNECT,
                code,
                eventMsg: this.sessionRecord
            });
            if (code) {
                WebsocketCloseReason.forEach((e) => {
                    if (e.code === code) {
                        this.emit(SessionEvents.ERROR, e.reason);
                    }
                });
            }
        });
        this.bot.ws.on("error", (e) => {
            this.alive=false
            this.bot.logger.mark("[CLIENT] 连接错误");
            this.emit(SessionEvents.CLOSED, { eventType: SessionEvents.CLOSED });
        });
        this.bot.ws.on("message", (data) => {
            this.bot.logger.debug(`[CLIENT] 收到消息: ${data}`);
            // 先将消息解析
            const wsRes = toObject<wsResData>(data);
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
                this.bot.logger.mark(`[CLIENT] 鉴权通过`);
                const { d, s } = wsRes;
                const { session_id, user = {} } = d;
                this.bot.self_id = user.id;
                this.bot.nickname = user.username;
                this.bot.status = user.status || 0;
                // 获取当前会话参数
                if (session_id && s) {
                    this.sessionRecord.sessionID = session_id;
                    this.sessionRecord.seq = s;
                    this.heartbeatParam.d = s;
                }
                this.bot.logger.info(`connect to ${user.username}(${user.id})`)
                this.isReconnect = false
                this.emit(SessionEvents.READY, { eventType: SessionEvents.READY, msg: d || "" });
                // 第一次发送心跳
                this.bot.logger.debug(`[CLIENT] 发送第一次心跳`, this.heartbeatParam);
                this.sendWs(this.heartbeatParam);
                return;
            }
            // 心跳测试
            if (wsRes.op === OpCode.HEARTBEAT_ACK || wsRes.t === SessionEvents.RESUMED) {
                if (!this.alive) {
                    this.alive = true;
                    this.emit(SessionEvents.EVENT_WS, { eventType: SessionEvents.READY });
                }
                this.bot.logger.debug("[CLIENT] 心跳校验", this.heartbeatParam);
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
                if (s) this.sessionRecord.seq = this.heartbeatParam.d = s;
                // OpenAPI事件分发
                this.bot.dispatchEvent(wsRes.t, wsRes);
            }
        });
        this.on(SessionEvents.ERROR, (e) => {
            this.bot.logger.error(`[CLIENT] 发生错误：${e}`);
        })
    }
}
