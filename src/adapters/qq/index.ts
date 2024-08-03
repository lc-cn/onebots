import { Adapter } from "@/adapter";
import { App } from "@/server/app";
import { OneBot, OneBotStatus } from "@/onebot";
import { Bot, Sendable, Quotable, MessageElem } from "qq-official-bot";
import * as path from "path";

export default class QQAdapter extends Adapter<"qq", Sendable> {
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
            path.resolve(path.dirname(require.resolve("qq-official-bot")), "../package.json"),
        );
        oneBot.dependency = `qq-official-bot v${pkg.version}`;
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
        oneBot.status = OneBotStatus.Online;
    }
    async setOffline(uin: string) {
        const oneBot = this.getOneBot<Bot>(uin);
        await oneBot?.internal.stop();
        oneBot.status = OneBotStatus.OffLine;
    }
    createOneBot(uin: string, protocol: Bot.Config, versions: OneBot.Config[]): OneBot {
        const oneBot = super.createOneBot<Bot>(uin, protocol, versions);
        oneBot.internal = new Bot({
            appid: oneBot.uin,
            logLevel: this.app.config.log_level,
            ...protocol,
        });
        oneBot.status = OneBotStatus.Pending;
        return oneBot;
    }
    async sendGroupMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, Sendable, string],
    ): Promise<OneBot.MessageRet<V>> {
        let [group_id, message, source] = args;
        if (version === "V11") {
            const [sub_type] = group_id.split(":");
            if (sub_type === "guild") {
                const [guild_id, channel_id] = group_id.slice(6);
                return await this.sendGuildMessage(uin, version, [
                    group_id,
                    channel_id,
                    message,
                    source,
                ]);
            }
        }
        const bot = this.getOneBot<Bot>(uin);
        let quote: Quotable | undefined;
        if (source) quote = { id: source };
        const result = await bot.internal.sendGroupMessage(group_id, message, quote);
        return {
            message_id:
                version === "V11"
                    ? bot.V11.transformToInt("message_id", `group:${group_id}${result.id}`)
                    : `group:${group_id}${result.id}`,
        } as OneBot.MessageRet<V>;
    }
    async sendPrivateMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, Sendable, string],
    ): Promise<OneBot.MessageRet<V>> {
        let [user_id, message, source] = args;
        if (version === "V11") {
            const [sub_type, real_user_id = sub_type] = user_id.split(":");
            if (sub_type === "direct")
                return await this.sendDirectMessage(uin, version, [
                    user_id.slice(7),
                    message,
                    source,
                ]);
            user_id = real_user_id;
        }
        const bot = this.getOneBot<Bot>(uin);
        let quote: Quotable | undefined;
        if (source) quote = { id: source };
        const result = await bot.internal.sendPrivateMessage(user_id, message, quote);
        return {
            message_id:
                version === "V11"
                    ? bot.V11.transformToInt("message_id", `private:${user_id}${result.id}`)
                    : `private:${user_id}${result.id}`,
        } as OneBot.MessageRet<V>;
    }

    async sendGuildMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, string, Sendable, string],
    ): Promise<OneBot.MessageRet<V>> {
        const [guild_id, channel_id, message, source] = args;
        const bot = this.getOneBot<Bot>(uin);
        let quote: Quotable | undefined;
        if (source) quote = { id: source };
        const result = await bot.internal.sendGuildMessage(channel_id, message, quote);
        return {
            message_id:
                version === "V11"
                    ? bot.V11.transformToInt("message_id", `${guild_id}:${channel_id}${result.id}`)
                    : `${guild_id}:${channel_id}${result.id}`,
        } as OneBot.MessageRet<V>;
    }
    async sendDirectMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, Sendable, string],
    ): Promise<OneBot.MessageRet<V>> {
        const [guild_id, message, source] = args;
        const bot = this.getOneBot<Bot>(uin);
        let quote: Quotable | undefined;
        if (source) quote = { id: source };
        const result = await bot.internal.sendDirectMessage(guild_id, message, quote);
        return {
            message_id:
                version === "V11"
                    ? bot.V11.transformToInt("message_id", `direct:${guild_id}${result.id}`)
                    : `direct:${guild_id}${result.id}`,
        } as OneBot.MessageRet<V>;
    }
    async deleteMessage(uin: string, version: "V11" | "V12", [message_id]: [string]) {
        const [from_type, from_id, ...msg_idArr] = message_id.split(":");
        const bot = this.getOneBot<Bot>(uin).internal;
        if (version === "V11") {
            const [sub_type, real_user_id = sub_type] = from_id.split(":");
            if (sub_type === "direct")
                return await bot.recallDirectMessage(from_id.slice(7), message_id);
        }
        switch (from_type) {
            case "private":
                return bot.recallPrivateMessage(from_id, msg_idArr.join(":"));
            case "group":
                return bot.recallGroupMessage(from_id, msg_idArr.join(":"));
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
    async uploadMedia(
        uin: string,
        target_id: string,
        target_type: "group" | "user",
        file_data: string,
        file_type: 1 | 2 | 3,
    ) {
        const bot = this.getOneBot<Bot>(uin).internal;
        return bot.uploadMedia(target_id, target_type, file_data, file_type);
    }
    fromSegment<V extends OneBot.Version>(
        onebot: OneBot<Bot>,
        version: V,
        segment: OneBot.Segment<V> | OneBot.Segment<V>[],
    ): Sendable {
        return []
            .concat(segment)
            .map(segment => {
                if (version === "V12" && ["image", "video", "audio"].includes(segment.type))
                    return onebot.V12.transformMedia(segment);
                if (segment.type === "reply") {
                    if (version === "V11")
                        segment.data.id = onebot.V11.getStrByInt("message_id", segment.data.id);
                    const [_1, _2, ...others] = (segment.data.id || "").split(":");
                    segment.data.id = others.join(":");
                }
                return segment;
            })
            .map(item => {
                if (typeof item === "string") return item;
                const { type, data } = item;
                return {
                    type,
                    ...data,
                };
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
            const { type, ...data } = item;
            return {
                type,
                data,
            };
        });
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
            sender: {
                ...(data?.sender || {}),
            },
            user_id: data.user_id || data.sender?.user_id,
        };
        if (result.message_id) {
            if (result.message_type === "private") {
                result.message_id = `${result.sub_type}:${
                    result.guild_id || result.group_id || result.user_id
                }:${result.message_id}`;
                result.user_id = `${result.sub_type}:${result.guild_id || result.group_id || result.user_id}`;
                if (result.sender) result.sender.user_id = result.user_id;
            } else if (result.message_type === "guild") {
                result.message_type = "group";
                result.message_id = `guild:${result.guild_id}:${result.channel_id}:${result.message_id}`;
                result.group_id = `guild:${result.guild_id}:${result.channel_id}`;
            } else {
                result.message_id = `${result.message_type}:${
                    result.channel_id || result.guild_id || result.group_id || result.user_id
                }:${result.message_id}`;
            }
        }
        delete result.bot;
        const oneBot = this.getOneBot<Bot>(uin);
        if (event === "message") {
            result.alt_message = result.raw_message || "";
        }
        switch (version) {
            case "V11":
                oneBot.V11.transformStrToIntForObj(result, ["message_id", "user_id", "group_id"]);
                oneBot.V11.transformStrToIntForObj(result.sender, ["user_id"]);
                oneBot.V11.transformStrToIntForObj(result.self, ["user_id"]);
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
