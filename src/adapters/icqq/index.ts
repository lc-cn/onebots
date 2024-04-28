import { Adapter } from "@/adapter";
import { App } from "@/server/app";
import { Client, Config as IcqqConfig, Quotable, Sendable } from "@icqqjs/icqq";
import process from "process";
import { rmSync } from "fs";
import { OneBot, OneBotStatus } from "@/onebot";
import * as path from "path";
import { genDmMessageId, genGroupMessageId } from "@icqqjs/icqq/lib/message";
import { processMessages } from "@/adapters/icqq/utils";

export default class IcqqAdapter extends Adapter<"icqq", Sendable> {
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
        oneBot.status = OneBotStatus.OffLine;
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
        const pkg = require(
            path.resolve(path.dirname(require.resolve("@icqqjs/icqq")), "../package.json"),
        );
        oneBot.dependency = `icqq v${pkg.version}`;
        oneBot.status = OneBotStatus.Pending;
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
            sender: {
                ...(data?.sender || {}),
                user_id: data?.sender?.user_id || data?.sender?.tiny_id,
            },
            user_id: data.user_id || data.sender?.user_id || data.sender?.tiny_id,
        };
        for(const key in result){
            if(['group','friend','member','discuss'].includes) delete result[key]
            else{
                const value=Reflect.get(result,key)
                if(typeof value==='function') delete result[key]
            }

        }
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
        if (event === "message") {
            result.alt_message = result.raw_message || "";
        }
        if (version === "V11" && result.message_id) {
            result.message_id = oneBot.V11.transformToInt("message_id", result.message_id);
        }
        return result;
    }

    async sendPrivateMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, Sendable, string?],
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
        args: [string, Sendable, string?],
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
        args: [string, string, Sendable, string?],
    ): Promise<OneBot.MessageRet<V>> {
        const [guild_id, channel_id, message, source] = args;
        const client: Client = this.oneBots.get(uin)?.internal;
        const result = await client.sendGuildMsg(
            guild_id,
            channel_id,
            await processMessages.call(this, uin, Number(channel_id), "guild", message),
        );
        const message_id = `${result.seq}:${result.rand}:${result.time}`;
        return {
            message_id:
                version === "V11"
                    ? this.oneBots.get(uin).V11.transformToInt("message_id", message_id)
                    : message_id,
        } as OneBot.MessageRet<V>;
    }

    async getMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        [message_id]: [string],
    ): Promise<OneBot.Message<V>> {
        const oneBot = this.getOneBot<Client>(uin);
        if (!oneBot) throw new Error("No one");
        let { message, ...result } = await oneBot.internal.getMsg.call(oneBot.internal,message_id);
        const segments = this.toSegment(version, message);
        return {
            ...result,
            message: segments,
        } as OneBot.Message<V>;
    }

    call<V extends OneBot.Version>(
        uin: string,
        version: V,
        method: string,
        args: any[] = [],
    ): Promise<any> {
        try {
            if (this[method]) return this[method](uin, version, args);
            const client=this.oneBots.get(uin)?.internal
            return client[method].call(this,...args);
        } catch {
            throw OneBot.UnsupportedMethodError;
        }
    }

    fromSegment<V extends OneBot.Version>(
        onebot: OneBot<Client>,
        version: V,
        segment: OneBot.Segment<V> | OneBot.Segment<V>[],
    ): Sendable {
        return []
            .concat(segment)
            .map(segment => {
                if (version === "V12" && ["image", "video", "audio"].includes(segment.type))
                    return onebot.V12.transformMedia(segment);
                return segment;
            })
            .map(item => {
                if (typeof item === "string") return item;
                const { type, data } = item;
                return { type, ...data };
            });
    }

    toSegment<V extends OneBot.Version>(version: V, message: Sendable): OneBot.Segment<V>[] {
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
        client.on("system.login.qrcode", function qrcodeHelper() {
            _this.logger.log("扫码后回车继续");
            process.stdin.once("data", () => {
                client.login();
            });
            disposeArr.push(() => {
                client.off("system.login.qrcode");
            });
        });
        client.on("system.login.device", function deviceHelper(e) {
            _this.logger.mark("请选择验证方式：1.短信验证  2.url验证");
            process.stdin.once("data", buf => {
                const input = buf.toString().trim();
                if (input === "1") {
                    client.sendSmsCode();
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
                client.off("system.login.device");
            });
        });
        client.on("system.login.slider", function sliderHelper(e) {
            _this.logger.mark("请输入滑块验证返回的ticket");
            process.stdin.once("data", e => {
                client.submitSlider(e.toString().trim());
            });
            disposeArr.push(() => {
                client.off("system.login.slider");
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
        await this.setOnline(oneBot.uin);
        return new Promise<Function>((resolve, reject) => {
            client.on("system.login.error", function errorHandler(e) {
                if (e.message.includes("密码错误")) {
                    process.stdin.once("data", e => {
                        client.login(e.toString().trim());
                    });
                } else {
                    _this.logger.error(e.message);
                    oneBot.status = OneBotStatus.OffLine;
                    clean();
                }
                client.off("system.login.error");
            });
            const clean = () => {
                clearTimeout(timer);
                while (disposeArr.length) {
                    disposeArr.shift()();
                }
            };
            client.on("system.online", () => {
                oneBot.nickname = client.nickname;
                oneBot.status = OneBotStatus.Online;
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
                oneBot.status = OneBotStatus.OffLine;
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
