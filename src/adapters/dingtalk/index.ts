import { Adapter } from "@/adapter";
import { App } from "@/server/app";
import { OneBot, OneBotStatus } from "@/onebot";
import { Bot, Sendable } from "node-dd-bot";
import * as path from "path";
import { V11 } from "@/service/V11";

export default class DingtalkAdapter extends Adapter<"dingtalk"> {
    constructor(app: App, config: DingtalkAdapter.Config) {
        super(app, "dingtalk", config);
        this.icon = `https://img.alicdn.com/imgextra/i4/O1CN01RtfAks1Xa6qJFAekm_!!6000000002939-2-tps-128-128.png`;
    }
    #disposes: Map<string, Function> = new Map<string, Function>();
    async startOneBot(oneBot: OneBot<Bot>) {
        await this.setOnline(oneBot.uin);
        const selfInfo = this.getBaseInfo(oneBot.uin);
        oneBot.avatar = selfInfo.avatar;
        oneBot.nickname = selfInfo.username;
        const pkg = require(
            path.resolve(path.dirname(require.resolve("node-dd-bot")), "../package.json"),
        );
        oneBot.dependency = `node-dd-bot v${pkg.version}`;
        const disposeArr: Function[] = [];
        const clean = () => {
            while (disposeArr.length > 0) {
                disposeArr.pop()();
            }
            oneBot.internal.stop();
        };
        const messageHandler = event => {
            this.emit("message.receive", oneBot.uin, event);
        };
        oneBot.internal.on("message", messageHandler);
        disposeArr.push(() => {
            oneBot.internal!.off("message", messageHandler);
        });
        return clean;
    }
    getBaseInfo(uin: string): { username: string; avatar: string } {
        const config = this.app.config[`${this.platform}.${uin}`].protocol;
        return {
            avatar: config.avatar || this.icon,
            username: config.username || "钉钉机器人",
        };
    }
    async setOnline(uin: string) {
        const oneBot = this.getOneBot<Bot>(uin);
        await oneBot?.internal.start();
        oneBot.status = OneBotStatus.Good;
    }
    async setOffline(uin: string) {
        const oneBot = this.getOneBot<Bot>(uin);
        await oneBot?.internal.stop();
        oneBot.status = OneBotStatus.Bad;
    }
    createOneBot(uin: string, protocol: Bot.Options, versions: OneBot.Config[]): OneBot {
        const oneBot = super.createOneBot<Bot>(uin, protocol, versions);
        oneBot.internal = new Bot({
            clientId: oneBot.uin,
            log_level: this.app.config.log_level,
            ...protocol,
        });
        oneBot.status = OneBotStatus.Online;
        return oneBot;
    }
    call(uin: string, version: string, method: string, args?: any[]): Promise<any> {
        const oneBot = this.oneBots.get(uin);
        if (!oneBot) {
            throw new Error(`未找到账号${uin}`);
        }
        if (typeof this[method] === "function") return this[method](uin, version, args);
        if (typeof oneBot.internal[method] !== "function") throw OneBot.UnsupportedMethodError;
        try {
            return oneBot.internal[method](...(args || []));
        } catch (e) {
            throw new Error(`call internal method error:${e.message}`);
        }
    }
    async sendPrivateMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, OneBot.MessageElement<V>[], string],
    ): Promise<OneBot.MessageRet<V>> {
        const [user_id, message] = args;
        const bot = this.getOneBot<Bot>(uin);
        const result = await bot.internal.sendPrivateMsg(
            user_id,
            message.map(item => {
                const { type, data } = item;
                return {
                    type,
                    ...data,
                };
            }),
        );
        return {
            message_id:
                version === "V11"
                    ? bot.V11.transformToInt("message_id", `private:${user_id}:${result}`)
                    : `private:${user_id}:${result}`,
        } as OneBot.MessageRet<V>;
    }
    async sendGroupMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, OneBot.MessageElement<V>[], string],
    ): Promise<OneBot.MessageRet<V>> {
        const [group_id, message] = args;
        const bot = this.getOneBot<Bot>(uin);
        const result = await bot.internal.sendGroupMsg(
            group_id,
            message.map(item => {
                const { type, data } = item;
                return {
                    type,
                    ...data,
                };
            }),
        );
        return {
            message_id:
                version === "V11"
                    ? bot.V11.transformToInt("message_id", `group:${group_id}:${result}`)
                    : `group:${group_id}:${result}`,
        } as OneBot.MessageRet<V>;
    }

    deleteMessage(uin: string, message_id: string) {
        const [from_type, from_id, ...msg_idArr] = message_id.split(":");
        const bot = this.getOneBot<Bot>(uin).internal;
        switch (from_type) {
            case "private":
                return bot.recallPrivateMsg(from_id, msg_idArr.join(":"));
            case "group":
                return bot.recallGroupMsg(from_id, msg_idArr.join(":"));
            case "direct":
                throw new Error(`暂不支持撤回${from_type}类型的消息`);
            case "guild":
                throw new Error(`暂不支持撤回${from_type}类型的消息`);
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
    toSegment<V extends OneBot.Version, M = Sendable>(version: V, message: M): OneBot.Segment<V>[] {
        return [].concat(message).map(item => {
            if (!item || typeof item !== "object")
                return {
                    type: "text",
                    data: {
                        text: item,
                    },
                };
            const { type, data, ...other } = item;
            return {
                type,
                data: {
                    ...data,
                    ...other,
                },
            };
        });
    }

    fromCqcode<V extends OneBot.Version>(version: V, message: string): OneBot.MessageElement<V>[] {
        const regExpMatchArray = message.match(/\[CQ:([a-z]+),(!])+]/g);
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
        for (const match of regExpMatchArray) {
            const [type, ...valueArr] = match.substring(1, match.length - 1).split(",");
            result.push({
                type: type,
                data: Object.fromEntries(
                    valueArr.map(item => {
                        const [key, value] = item.split("=");
                        return [key, value];
                    }),
                ),
            });
        }
        return result;
    }

    toCqcode<V extends OneBot.Version>(version: V, messageArr: OneBot.MessageElement<V>[]): string {
        return []
            .concat(messageArr)
            .map(item => {
                if (typeof item === "string") return item;
                if (item.type === "text") return item.data?.text || item.text;
                const dataStr = Object.entries(item.data).map(([key, value]) => {
                    // is Buffer
                    if (value instanceof Buffer) return `${key}=${value.toString("base64")}`;
                    // is Object
                    if (value instanceof Object) return `${key}=${JSON.stringify(value)}`;
                    // is Array
                    if (value instanceof Array)
                        return `${key}=${value.map(v => JSON.stringify(v)).join(",")}`;
                    // is String
                    return `${key}=${item[key]}`;
                });
                return `[CQ:${item.type},${dataStr.join(",")}]`;
            })
            .join("");
    }
    formatEventPayload<V extends OneBot.Version>(
        uin: string,
        version: V,
        event: string,
        data: any,
    ): OneBot.Payload<V> {
        const oneBot = this.getOneBot<Bot>(uin);
        const result = {
            id: data.id || Math.random().toString(36).slice(2),
            [version === "V12" ? "type" : "post_type"]: event,
            version: version,
            self: {
                platform: "dingtalk",
                user_id: data.self_id,
            },
            detail_type: data.message_type || data.notice_type || data.request_type,
            platform: "dingtalk",
            time: data.timestamp,
            ...data,
            message_id: `${data.message_type}:${data.group_id || data.user_id}:${data.message_id}`,
        };
        delete result.bot;
        if (event === "message") {
            result.message = this.transformMessage(uin, version, result.message);
            result.alt_message = result.raw_message || "";
        }
        if (version === "V11") {
            oneBot.V11.transformStrToIntForObj(result, ["user_id", "group_id", "message_id"]);
        }
        return result;
    }
    async start(uin: string) {
        const startOneBots = [...this.oneBots.values()].filter(oneBot => {
            return uin ? oneBot.uin === uin : true;
        });
        for (const oneBot of startOneBots) {
            this.#disposes.set(oneBot.uin, await this.startOneBot(oneBot));
        }
        const { protocol } = this.config;

        await super.start();
    }
    async stop(uin?: string) {
        const stopOneBots = [...this.oneBots.values()].filter(oneBot => {
            return uin ? oneBot.uin === uin : true;
        });
        for (const oneBot of stopOneBots) {
            const dispose = this.#disposes.get(oneBot.uin);
            if (dispose) {
                dispose();
            }
        }
        await super.stop();
    }
    getSelfInfo<V extends OneBot.Version>(uin: string, version: V): OneBot.SelfInfo<V> {
        const oneBot = this.oneBots.get(uin);
        return {
            nickname: oneBot?.internal?.nickname,
            status: OneBotStatus.Online,
        } as OneBot.SelfInfo<V>;
    }
}
declare module "@/adapter" {
    export namespace Adapter {
        export interface Configs {
            dingtalk: DingtalkAdapter.Config;
        }
    }
}
export namespace DingtalkAdapter {
    export interface Config extends Adapter.Config<"dingtalk"> {
        protocol: Omit<Bot.Options, "clientId"> & {
            username?: string;
            avatar?: string;
        };
    }
}
