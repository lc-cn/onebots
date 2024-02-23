import { EventEmitter } from "events";
import { App } from "@/server/app";
import { OneBot } from "@/onebot";
import { Dict } from "@zhinjs/shared";
import { Logger } from "log4js";
import { V11 } from "@/service/V11";

export abstract class Adapter<T extends string = string> extends EventEmitter {
    oneBots: Map<string, OneBot> = new Map<string, OneBot>();
    #logger: Logger;
    icon: string;
    protected constructor(
        public app: App,
        public platform: T,
        public config: Adapter.Configs[T],
    ) {
        super();
    }
    transformMessage(uin: string, version: OneBot.Version, message: any) {
        const onebot = this.getOneBot(uin);
        const instance = onebot.instances.find(V => V.version === version) as V11;
        return instance.config.post_message_format === "string"
            ? this.toCqcode(version, message)
            : this.toSegment(version, message);
    }
    getOneBot<C = any>(uin: string) {
        return this.oneBots.get(uin) as OneBot<C> | undefined;
    }
    get logger() {
        return (this.#logger ||= this.app.getLogger(this.platform));
    }
    get info() {
        return {
            platform: this.platform,
            config: this.config,
            icon: this.icon,
            bots: [...this.oneBots.values()].map(bot => {
                return bot.info;
            }),
        };
    }
    async setOnline(uin: string) {}
    async setOffline(uin: string) {}
    getLogger(uin: string, version?: string) {
        if (!version) return this.app.getLogger(`${this.platform}-${uin}`);
        return this.app.getLogger(`${this.platform}-${version}(${uin})`);
    }
    createOneBot<T = any>(uin: string, protocol: Dict, versions: OneBot.Config[]): OneBot<T> {
        const oneBot = new OneBot<T>(this, uin, versions);
        this.oneBots.set(uin, oneBot);
        return oneBot;
    }
    async start(uin?: string): Promise<any> {
        const startOneBots = [...this.oneBots.values()].filter(oneBot => {
            return uin ? oneBot.uin === uin : true;
        });
        for (const oneBot of startOneBots) {
            await this.setOnline(oneBot.uin);
            await oneBot.start();
        }
        this.app.emit("adapter.start", this.platform);
    }
    async stop(uin?: string, force?: boolean): Promise<any> {
        const stopOneBots = [...this.oneBots.values()].filter(oneBot => {
            return uin ? oneBot.uin === uin : true;
        });
        for (const oneBot of stopOneBots) {
            await oneBot.stop(force);
            await this.setOffline(oneBot.uin);
        }
        this.app.emit("adapter.stop", this.platform);
    }
}
type GroupInfo = {
    group_id: string | number;
    group_name: string;
};
type UserInfo = {
    user_id: string | number;
    user_name: string;
};
export interface Adapter extends Adapter.Base {
    call<V extends OneBot.Version>(
        uin: string,
        version: V,
        method: string,
        args?: any[],
    ): Promise<any>;
}
export namespace Adapter {
    export interface Base {
        toSegment<V extends OneBot.Version, M = any>(version: V, message: M): OneBot.Segment<V>[];
        fromSegment<V extends OneBot.Version>(
            version: V,
            segment: OneBot.Segment<V>,
        ): OneBot.MessageElement<V>[];
        toCqcode<V extends OneBot.Version>(version: V, message: OneBot.MessageElement<V>[]): string;
        fromCqcode<V extends OneBot.Version>(
            version: V,
            message: string,
        ): OneBot.MessageElement<V>[];
        getSelfInfo<V extends OneBot.Version>(uin: string, version: V): OneBot.SelfInfo<V>;
        /** 格式化事件 */
        formatEventPayload<V extends OneBot.Version>(
            uin: string,
            version: V,
            event: string,
            payload: Dict,
        ): OneBot.Payload<V>;
        /** 解析消息事件的消息 */
        parseMessage<V extends OneBot.Version>(version: V, payload: Dict): OneBot.Message<V>[];
        /** 获取群列表 */
        getGroupList<V extends OneBot.Version>(
            uin: string,
            version: V,
        ): Promise<OneBot.GroupInfo<V>[]>;
        /** 获取好友列表 */
        getFriendList<V extends OneBot.Version>(
            uin: string,
            version: V,
        ): Promise<OneBot.UserInfo<V>[]>;
        getGroupMemberList<V extends OneBot.Version>(
            uin: string,
            version: V,
            args: [string],
        ): Promise<OneBot.GroupMemberInfo<V>[]>;
        /** 发送群消息 */
        sendGroupMessage<V extends OneBot.Version>(
            uin: string,
            version: V,
            args: [string, OneBot.MessageElement<V>[], string],
        ): Promise<OneBot.MessageRet<V>>;
        /** 发送私聊消息 */
        sendPrivateMessage<V extends OneBot.Version>(
            uin: string,
            version: V,
            args: [string, OneBot.MessageElement<V>[], string],
        ): Promise<OneBot.MessageRet<V>>;
        sendGuildMessage<V extends OneBot.Version>(
            uin: string,
            version: V,
            args: [string, OneBot.MessageElement<V>[], string],
        ): Promise<OneBot.MessageRet<V>>;
        /** 发送私聊消息 */
        sendDirectMessage<V extends OneBot.Version>(
            uin: string,
            version: V,
            args: [string, OneBot.MessageElement<V>[], string],
        ): Promise<OneBot.MessageRet<V>>;
        /** 获取消息 */
        getMessage<V extends OneBot.Version>(
            uin: string,
            version: V,
            args: [string],
        ): Promise<OneBot.Message<V>>;
        deleteMessage<V extends OneBot.Version>(
            uin: string,
            version: V,
            args: [string],
        ): Promise<boolean>;
    }
    export interface Configs {
        [key: string]: Adapter.Config;
    }
    export type Config<T extends string = string> = {
        platform?: T;
        versions: OneBot.Config<OneBot.Version>[];
        protocol?: Dict;
    } & Record<string, any>;
}
