import { Adapter } from "@/adapter";
import { App } from "@/server/app";
import { Client, Config as IcqqConfig, MessageElem, Quotable } from "icqq";
import process from "process";
import { rmSync } from "fs";
import { OneBot, OneBotStatus } from "@/onebot";
import * as path from "path";
import { shareMusic } from "@/service/shareMusicCustom";
import { genDmMessageId, genGroupMessageId } from "icqq/lib/message";

async function processMessages(
    this: IcqqAdapter,
    uin: string,
    target_id: number,
    target_type: "group" | "private",
    list: OneBot.MessageElement<OneBot.Version>[],
) {
    let result: MessageElem[] = [];
    for (const item of list) {
        const { type, data, ...other } = item;
        switch (type) {
            case "node": {
                result.push({
                    type,
                    ...data,
                    message: await processMessages.call(
                        this,
                        uin,
                        data.user_id,
                        "private",
                        data.content || [],
                    ),
                });
                break;
            }
            case "music": {
                if (String(item.data.platform) === "custom") {
                    item.data.platform = item.data["subtype"]; // gocq 的平台数据存储在 subtype 内，兼容 icqq 时要求前端必须发送 id 字段
                }
                const { type, data } = item;
                await shareMusic.call(
                    this[target_type === "private" ? "pickFriend" : "pickGroup"](target_id),
                    {
                        type,
                        ...data,
                    },
                );
                break;
            }
            case "share": {
                await this[target_type === "private" ? "pickFriend" : "pickGroup"](
                    target_id,
                ).shareUrl(item.data);
                break;
            }
            case "video":
            case "audio":
            case "image": {
                if (item["file_id"]?.startsWith("base64://"))
                    item["file_id"] = Buffer.from(item["file_id"].slice(9), "base64");
                if (item["file"]?.startsWith("base64://"))
                    item["file"] = Buffer.from(item["file"].slice(9), "base64");
                result.push({
                    type,
                    ...data,
                    ...other,
                });
                break;
            }
            case "reply": {
                const oneBot = this.getOneBot(uin);
                const message_id = oneBot.V11.getStrByInt("message_id", data.id);
                const msg = await oneBot.internal.getMsg(message_id);
                result.push({
                    type: "quote",
                    ...msg,
                });
                break;
            }
            default: {
                result.push({
                    type,
                    ...data,
                    ...other,
                });
            }
        }
    }
    return result;
}

export default class IcqqAdapter extends Adapter<"icqq"> {
    #password?: string;
    #disposes: Map<string, Function> = new Map<string, Function>();

    constructor(app: App, config: IcqqAdapter.Config) {
        super(app, "icqq", config);
        this.icon = `https://qzonestyle.gtimg.cn/qzone/qzact/act/external/tiqq/logo.png`;
    }

    async setOnline(uin: string) {
        const oneBot = this.getOneBot<Client>(uin);
        if (!oneBot) throw new Error("No one");
        await oneBot.internal.login(parseInt(uin), this.#password);
    }

    async setOffline(uin: string) {
        const oneBot = this.getOneBot<Client>(uin);
        if (!oneBot) throw new Error("No one");
        await oneBot.internal.logout();
        oneBot.status = OneBotStatus.Bad;
    }

    callApi<V extends OneBot.Version>(uin: string, version: V, [name, args]: [string, any[]]) {
        const oneBot = this.getOneBot<Client>(uin);
        if (!oneBot) throw new Error("No one");
        if (!oneBot.internal[name]) throw new Error(`internal no api ${name}`);
        return oneBot[version][name](...args);
    }

    createOneBot(uin: string, protocol: IcqqConfig, versions: OneBot.Config[]): OneBot {
        const oneBot = super.createOneBot<Client>(uin, protocol, versions);
        this.#password = this.app.config[`icqq.${uin}`].password;
        oneBot.avatar = `https://q1.qlogo.cn/g?b=qq&s=100&nk=` + uin;
        const pkg = require(path.resolve(path.dirname(require.resolve("icqq")), "../package.json"));
        oneBot.dependency = `icqq v${pkg.version}`;
        oneBot.status = OneBotStatus.Online;
        oneBot.internal = new Client({
            ...defaultIcqqConfig,
            log_level: this.app.config.log_level,
            ...protocol,
        });
        return oneBot;
    }

    formatEventPayload<V extends OneBot.Version>(
        uin: string,
        version: V,
        event: string,
        data: any,
    ): OneBot.Payload<V> {
        const oneBot = this.getOneBot<Client>(uin);
        const result = {
            id: data.id || Math.random().toString(36).slice(2),
            type: event,
            version: version,
            self: {
                platform: "qq",
                user_id: data.self_id,
            },
            detail_type: data.message_type || data.notice_type || data.request_type,
            platform: "qq",
            ...data,
        };
        if (data.source) {
            const message_id =
                data.message_type === "group"
                    ? genGroupMessageId(
                          data.group_id,
                          data.sender.user_id,
                          data.source?.seq,
                          data.source?.rand,
                          data.source?.time,
                          data.source?.pktnum,
                      )
                    : genDmMessageId(
                          data.sender.user_id,
                          data.source?.seq,
                          data.source?.rand,
                          data.source?.time,
                      );
            const replyEl = {
                type: "reply",
                id:
                    version === "V11"
                        ? oneBot.V11.transformToInt("message_id", message_id)
                        : message_id,
            };
            /* 去除群聊消息的第一个引用消息段 */
            if (result.detail_type === "group" && data.message[0]?.type === "at") {
                data.message[0] = replyEl;
            } else {
                data.message.unshift(replyEl);
            }
        }
        if (version === "V11" && result.message_id) {
            result.message_id = oneBot.V11.transformToInt("message_id", result.message_id);
        }
        return result;
    }

    async sendPrivateMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, OneBot.MessageElement<V>[], string?],
    ): Promise<OneBot.MessageRet<V>> {
        const [user_id, message, source] = args;
        const client: Client = this.oneBots.get(uin)?.internal;
        let quote: Quotable | undefined;
        if (source) quote = await client.getMsg(source);
        const result = await client.sendPrivateMsg(
            parseInt(user_id),
            await processMessages.call(this, uin, user_id, "private", message),
            quote,
        );
        return {
            message_id:
                version === "V11"
                    ? this.oneBots.get(uin).V11.transformToInt("message_id", result.message_id)
                    : result.message_id,
        } as OneBot.MessageRet<V>;
    }

    deleteMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string],
    ): Promise<boolean> {
        const bot = this.getOneBot<Client>(uin).internal;
        return bot.deleteMsg(args[0]);
    }

    async sendGroupMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, OneBot.MessageElement<V>[], string?],
    ): Promise<OneBot.MessageRet<V>> {
        const [group_id, message, source] = args;
        const client: Client = this.oneBots.get(uin)?.internal;
        let quote: Quotable | undefined;
        if (source) quote = await client.getMsg(source);
        const result = await client.sendGroupMsg(
            parseInt(group_id),
            await processMessages.call(this, uin, group_id, "group", message),
            quote,
        );
        return {
            message_id:
                version === "V11"
                    ? this.oneBots.get(uin).V11.transformToInt("message_id", result.message_id)
                    : result.message_id,
        } as OneBot.MessageRet<V>;
    }

    async sendGuildMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, OneBot.MessageElement<V>[], string?],
    ): Promise<OneBot.MessageRet<V>> {
        const [target_id, message, source] = args;
        const client: Client = this.oneBots.get(uin)?.internal;
        const [guild_id, channel_id] = target_id.split(":");
        const result = await client.sendGuildMsg(
            guild_id,
            channel_id,
            await processMessages.call(this, uin, target_id, "channel", message),
        );
        const message_id = `${result.seq}:${result.rand}:${result.time}`;
        return {
            message_id:
                version === "V11"
                    ? this.oneBots.get(uin).V11.transformToInt("message_id", message_id)
                    : message_id,
        } as OneBot.MessageRet<V>;
    }

    getMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        [message_id]: [string],
    ): Promise<OneBot.Message<V>> {
        const oneBot = this.getOneBot<Client>(uin);
        if (!oneBot) throw new Error("No one");
        return oneBot.internal.getMsg(message_id);
    }

    call<V extends OneBot.Version>(
        uin: string,
        version: V,
        method: string,
        args: any[] = [],
    ): Promise<any> {
        try {
            if (this[method]) return this[method](uin, version, args);
            return this.oneBots.get(uin)?.internal[method](...args);
        } catch {
            throw OneBot.UnsupportedMethodError;
        }
    }

    fromSegment<V extends OneBot.Version>(
        version: V,
        segment: OneBot.Segment<V> | OneBot.Segment<V>[],
    ): OneBot.MessageElement<V>[] {
        return [].concat(segment).map(item => {
            if (typeof item === "string")
                return {
                    type: "text",
                    data: {
                        text: item,
                    },
                };
            return item;
        });
    }

    toSegment<V extends OneBot.Version, M = any>(version: V, message: M): OneBot.Segment<V>[] {
        return [].concat(message).map(item => {
            if (typeof item !== "object")
                item = {
                    type: "text",
                    data: {
                        text: item,
                    },
                };
            const { type, ...data } = item;
            return {
                type,
                data,
            };
        });
    }

    fromCqcode<V extends OneBot.Version>(version: V, message: string): OneBot.MessageElement<V>[] {
        const regExpMatchArray = message.match(/\[CQ:([a-z]+),([^]])+]/);
        if (!regExpMatchArray)
            return [
                {
                    type: "text",
                    data: {
                        text: message,
                    },
                },
            ];
        const result: OneBot.MessageElement<V>[] = [];
        while (message.length) {
            const [match] = message.match(/\[CQ:([a-z]+),([^]])+]/) || [];
            if (!match) break;
            const prevText = message.substring(0, match.length);
            if (prevText) {
                result.push({
                    type: "text",
                    data: {
                        text: prevText,
                    },
                });
            }
            const [type, ...valueArr] = match.substring(1, match.length - 1).split(",");
            result.push({
                type: type,
                data: Object.fromEntries(
                    valueArr.map(item => {
                        const [key, value] = item.split("=");
                        return [key, type === "reply" && key === "id" ? +value : value];
                    }),
                ),
            });
            message = message.substring(match.length);
        }
        if (message.length) {
            result.push({
                type: "text",
                data: {
                    text: message,
                },
            });
        }
        return result;
    }

    materialize( content: string ): string {
        return content
            .replace( /&(?!(amp|#91|#93|#44);)/g, "&amp;" )
            .replace( /\[/g, "&#91;" )
            .replace( /]/g, "&#93;" )
            .replace( /,/g, "&#44;" )
    }

    toCqcode<V extends OneBot.Version>(version: V, messageArr: OneBot.MessageElement<V>[]): string {
        return []
            .concat(messageArr)
            .map(item => {
                if (typeof item === "string") return item;
                if (item.type === "text") return item.data?.text || item.text;
                let dataStr: string[];
                if (typeof item.data === "string") {
                    dataStr = [`data=${ this.materialize(item.data) }`];
                } else {
                    dataStr = Object.entries(item.data || item).map(([key, value]) => {
                        // is Buffer
                        if (value instanceof Buffer) return `${key}=${value.toString("base64")}`;
                        // is Object
                        if (value instanceof Object) return `${key}=${JSON.stringify(value)}`;
                        // is Array
                        if (value instanceof Array)
                            return `${key}=${value.map(v => JSON.stringify(v)).join(",")}`;
                        // is String
                        return `${key}=${item.data?.[key] || item[key]}`;
                    });
                }
                return `[CQ:${item.type},${dataStr.join(",")}]`;
            })
            .join("");
    }

    getSelfInfo<V extends OneBot.Version>(uin: string, version: V): OneBot.SelfInfo<V> {
        const client: Client = this.oneBots.get(uin).internal;
        return {
            nickname: client.nickname,
            status: this.oneBots.get(uin).status,
        } as OneBot.SelfInfo<V>;
    }

    async startOneBot(oneBot: OneBot) {
        const _this = this;
        const disposeArr = [];
        const client: Client = oneBot.internal;
        client.trap("system.login.qrcode", function qrcodeHelper() {
            _this.logger.log("扫码后回车继续");
            process.stdin.once("data", () => {
                this.login();
            });
            disposeArr.push(() => {
                this.off("system.login.qrcode", qrcodeHelper);
            });
        });
        client.trap("system.login.device", function deviceHelper(e) {
            _this.logger.mark("请选择验证方式：1.短信验证  2.url验证");
            process.stdin.once("data", buf => {
                const input = buf.toString().trim();
                if (input === "1") {
                    this.sendSmsCode();
                    _this.logger.mark("请输入短信验证码:");
                    const terminalInputHandler = buf => {
                        client.submitSmsCode(buf.toString().trim());
                    };
                    process.stdin.once("data", terminalInputHandler);
                } else {
                    _this.logger.mark(`请前往：${e.url} 完成验证后回车继续`);
                    const terminalInputHandler = () => {
                        client.login();
                    };
                    process.stdin.once("data", terminalInputHandler);
                }
            });
            disposeArr.push(() => {
                this.off("system.login.device", deviceHelper);
            });
        });
        client.trap("system.login.slider", function sliderHelper(e) {
            _this.logger.mark("请输入滑块验证返回的ticket");
            process.stdin.once("data", e => {
                this.submitSlider(e.toString().trim());
            });
            disposeArr.push(() => {
                this.off("system.login.slider", sliderHelper);
            });
        });
        disposeArr.push(
            client.on("message", event => {
                this.emit("message.receive", oneBot.uin, event);
            }),
        );
        disposeArr.push(
            client.on("notice", event => {
                this.emit("notice.receive", oneBot.uin, event);
            }),
        );
        disposeArr.push(
            client.on("request", event => {
                this.emit("request.receive", oneBot.uin, event);
            }),
        );
        this.setOnline(oneBot.uin);
        return new Promise<Function>((resolve, reject) => {
            client.trap("system.login.error", function errorHandler(e) {
                if (e.message.includes("密码错误")) {
                    process.stdin.once("data", e => {
                        this.login(e.toString().trim());
                    });
                } else {
                    _this.logger.error(e.message);
                    oneBot.status = OneBotStatus.Bad;
                    clean();
                }
                this.off("system.login.error", errorHandler);
            });
            const clean = () => {
                clearTimeout(timer);
                while (disposeArr.length) {
                    disposeArr.shift()();
                }
            };
            client.trap("system.online", () => {
                oneBot.nickname = client.nickname;
                oneBot.status = OneBotStatus.Good;
                this.app.ws.clients.forEach(client => {
                    client.send(
                        JSON.stringify({
                            event: "bot.change",
                            data: oneBot.info,
                        }),
                    );
                });
                clearTimeout(timer);
                resolve(clean);
            });
            const timer = setTimeout(() => {
                oneBot.status = OneBotStatus.Bad;
                clean();
                reject("登录超时");
            }, this.app.config.timeout * 1000);
        });
    }

    async start(uin?: string) {
        const startOneBots = [...this.oneBots.values()].filter(oneBot => {
            return uin ? oneBot.uin === uin : true;
        });
        for (const oneBot of startOneBots) {
            this.#disposes.set(oneBot.uin, await this.startOneBot(oneBot));
        }
        await super.start();
    }

    async stop(uin?: string, force?: boolean) {
        const stopOneBots = [...this.oneBots.values()].filter(oneBot => {
            return uin ? oneBot.uin === uin : true;
        });
        for (const oneBot of stopOneBots) {
            const dispose = this.#disposes.get(oneBot.uin);
            if (dispose) {
                dispose();
            }
            if (force) {
                rmSync(oneBot.internal.dir, { force: true, recursive: true });
            }
        }
        await super.stop();
    }
}
declare module "@/adapter" {
    export namespace Adapter {
        export interface Configs {
            icqq: IcqqAdapter.Config;
        }
    }
}
export const defaultIcqqConfig: IcqqConfig = {
    platform: 2,
    data_dir: path.join(process.cwd(), "data"),
};
export namespace IcqqAdapter {
    export interface Config extends Adapter.Config<"icqq"> {
        protocol?: IcqqConfig;
        password?: string;
    }
}
