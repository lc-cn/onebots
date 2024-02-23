import { Adapter } from "@/adapter";
import { App } from "@/server/app";
import { OneBot, OneBotStatus } from "@/onebot";
import { Bot, Sendable, Quotable } from "qq-group-bot";
import * as path from "path";
import { V11 } from "@/service/V11";

export default class QQAdapter extends Adapter<"qq"> {
    constructor(app: App, config: QQAdapter.Config) {
        super(app, "qq", config);
        this.icon = `https://qzonestyle.gtimg.cn/qzone/qzact/act/external/tiqq/logo.png`;
    }
    #disposes: Map<string, Function> = new Map<string, Function>();
    async startOneBot(oneBot: OneBot<Bot>) {
        await this.setOnline(oneBot.uin);
        const selfInfo = await oneBot.internal.getSelfInfo();
        oneBot.avatar = selfInfo.avatar;
        oneBot.nickname = selfInfo.username;
        const pkg = require(
            path.resolve(path.dirname(require.resolve("qq-group-bot")), "../package.json"),
        );
        oneBot.dependency = `qq-group-bot v${pkg.version}`;
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
    createOneBot(uin: string, protocol: Bot.Config, versions: OneBot.Config[]): OneBot {
        const oneBot = super.createOneBot<Bot>(uin, protocol, versions);
        oneBot.internal = new Bot({
            appid: oneBot.uin,
            logLevel: this.app.config.log_level,
            ...protocol,
        });
        oneBot.status = OneBotStatus.Online;
        return oneBot;
    }
    async sendGroupMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, OneBot.MessageElement<V>[], string],
    ): Promise<OneBot.MessageRet<V>> {
        const [group_id, message, source] = args;
        const bot = this.getOneBot<Bot>(uin);
        let quote: Quotable | undefined;
        if (source) quote = { id: source };
        const result = await bot.internal.sendGroupMessage(
            group_id,
            message.map(({ type, data }) => ({ type, ...data })),
            quote,
        );
        if (result.msg === "success") {
            return {
                message_id:
                    version === "V11"
                        ? bot.V11.transformToInt("message_id", `group:${group_id}${result.msg_id}`)
                        : `group:${group_id}${result.msg_id}`,
            } as OneBot.MessageRet<V>;
        }
        throw new Error(result.msg);
    }
    async sendPrivateMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, OneBot.MessageElement<V>[], string],
    ): Promise<OneBot.MessageRet<V>> {
        const [user_id, message, source] = args;
        const bot = this.getOneBot<Bot>(uin);
        let quote: Quotable | undefined;
        if (source) quote = { id: source };
        const result = await bot.internal.sendPrivateMessage(
            user_id,
            message.map(({ type, data }) => ({ type, ...data })),
            quote,
        );
        if (result.msg === "success") {
            return {
                message_id:
                    version === "V11"
                        ? bot.V11.transformToInt("message_id", `private:${user_id}${result.msg_id}`)
                        : `private:${user_id}${result.msg_id}`,
            } as OneBot.MessageRet<V>;
        }
        throw new Error(result.msg);
    }

    async sendGuildMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, OneBot.MessageElement<V>[], string],
    ): Promise<OneBot.MessageRet<V>> {
        const [channel_id, message, source] = args;
        const bot = this.getOneBot<Bot>(uin);
        let quote: Quotable | undefined;
        if (source) quote = { id: source };
        const result = await bot.internal.sendGuildMessage(
            channel_id,
            message.map(({ type, data }) => ({ type, ...data })),
            quote,
        );
        if (result.msg === "success") {
            return {
                message_id:
                    version === "V11"
                        ? bot.V11.transformToInt(
                              "message_id",
                              `guild:${channel_id}${result.msg_id}`,
                          )
                        : `guild:${channel_id}${result.msg_id}`,
            } as OneBot.MessageRet<V>;
        }
        throw new Error(result.msg);
    }
    async sendDirectMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, OneBot.MessageElement<V>[], string],
    ): Promise<OneBot.MessageRet<V>> {
        const [guild_id, message, source] = args;
        const bot = this.getOneBot<Bot>(uin);
        let quote: Quotable | undefined;
        if (source) quote = { id: source };
        const result = await bot.internal.sendDirectMessage(
            guild_id,
            message.map(({ type, data }) => ({ type, ...data })),
            quote,
        );
        if (result.msg === "success") {
            return {
                message_id:
                    version === "V11"
                        ? bot.V11.transformToInt("message_id", `direct:${guild_id}${result.msg_id}`)
                        : `direct:${guild_id}${result.msg_id}`,
            } as OneBot.MessageRet<V>;
        }
        throw new Error(result.msg);
    }
    deleteMessage(uin: string, message_id: string) {
        const [from_type, from_id, ...msg_idArr] = message_id.split(":");
        const bot = this.getOneBot<Bot>(uin).internal;
        switch (from_type) {
            case "private":
            case "group":
                throw new Error(`暂不支持撤回${from_type}类型的消息`);
            case "direct":
                return bot.recallDirectMessage(from_id, msg_idArr.join(":"));
            case "guild":
                return bot.recallGuildMessage(from_id, msg_idArr.join(":"));
        }
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
                    return `${key}=${value}`;
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
        const result = {
            id: data.id || Math.random().toString(36).slice(2),
            [version === "V12" ? "type" : "post_type"]: event,
            version: version,
            self: {
                platform: "qq",
                user_id: data.self_id,
            },
            detail_type: data.message_type || data.notice_type || data.request_type,
            platform: "qq",
            time: data.timestamp,
            ...data,
        };
        if (data.message_id) {
            data.message_id = `${data.message_type}:${
                data.channel_id || data.guild_id || data.group_id || data.user_id
            }:${data.message_id}`;
        }
        delete result.bot;
        const oneBot = this.getOneBot<Bot>(uin);
        if (event === "message") {
            result.message = this.transformMessage(uin, version, result.message);
            result.alt_message = result.raw_message || "";
        }
        switch (version) {
            case "V11":
                oneBot.V11.transformStrToIntForObj(result, ["message_id", "user_id", "group_id"]);
                oneBot.V11.transformStrToIntForObj(result.sender, ["user_id "]);
                oneBot.V11.transformStrToIntForObj(result.self, ["user_id "]);
                break;
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
            qq: QQAdapter.Config;
        }
    }
}
export namespace QQAdapter {
    export interface Config extends Adapter.Config<"qq"> {
        protocol: Omit<Bot.Config, "appid">;
    }
}
