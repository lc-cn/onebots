import { EventEmitter } from "events";
import { deepClone, deepMerge } from "./utils";
import { V11 } from "./service/V11";
import { V12 } from "./service/V12";
import { Adapter } from "@/adapter";
import { Service } from "@/service";
import { Logger } from "log4js";
import { App } from "@/server/app";

export class NotFoundError extends Error {
    message = "不支持的API";
}

export class OneBot<T = any> extends EventEmitter {
    public config: OneBot.Config[];
    status: OneBotStatus;
    avatar: string;
    nickname: string;
    dependency: string;
    #logger: Logger;
    protected password: string;
    internal: T;
    instances: (V11 | V12)[];

    get app() {
        return this.adapter.app;
    }

    get V11() {
        return this.instances.find(i => i.version === "V11") as V11;
    }

    get V12() {
        return this.instances.find(i => i.version === "V12") as V12;
    }

    get platform() {
        return this.adapter.platform;
    }

    get logger() {
        return (this.#logger ||= this.adapter.getLogger(this.uin));
    }

    get info() {
        return {
            uin: this.uin,
            status: this.status,
            platform: this.platform,
            avatar: this.avatar,
            nickname: this.nickname,
            dependency: this.dependency,
            urls: this.instances.map(ins => {
                return `/${this.platform}/${this.uin}/${ins.version}`;
            }),
        };
    }

    constructor(
        public adapter: Adapter,
        public readonly uin: string,
        version_configs: OneBot.Config[],
    ) {
        super();

        this.config = version_configs.map(c => {
            if (!c.version) c.version = "V11";
            switch (c.version) {
                case "V11":
                    return deepMerge(deepClone(this.adapter.app.config.general.V11), c);
                case "V12":
                    return deepMerge(deepClone(this.adapter.app.config.general.V12), c);
                default:
                    throw new Error("不支持的oneBot版本：" + c.version);
            }
        });
        this.instances = this.config.map(c => {
            switch (c.version) {
                case "V11":
                    return new V11(this, c as OneBot.Config<"V11">);
                case "V12":
                    return new V12(this, c as OneBot.Config<"V12">);
                default:
                    throw new Error("不支持的oneBot版本：" + c.version);
            }
        });
        this.status = OneBotStatus.Pending;
    }

    async start() {
        for (const instance of this.instances) {
            instance.start();
        }
    }

    async stop(force?: boolean) {
        for (const instance of this.instances) {
            await instance.stop(force);
        }
        this.emit("stop");
    }

    getGroupList<V extends OneBot.Version>(version: V): Promise<OneBot.GroupInfo<V>[]> {
        return this.adapter.getGroupList(this.uin, version);
    }

    getFriendList<V extends OneBot.Version>(version: V): Promise<OneBot.UserInfo<V>[]> {
        return this.adapter.getFriendList(this.uin, version);
    }

    async dispatch(event, data) {
        for (const instance of this.instances) {
            instance.dispatch(
                instance.format(
                    event,
                    this.adapter.formatEventPayload(this.uin, instance.version, event, data),
                ),
            );
        }
    }
}

export enum OneBotStatus {
    Pending = "pending", // 上线中
    Online = "online", // 已上线
    OffLine = "offline", // 已离线
}

export namespace OneBot {
    export type Filters = {};
    export type Version = "V11" | "V12";
    export type Config<V extends Version = Version> = {
        version?: V;
        filters?: Service.Filters;
    } & (V extends "V11" ? V11.Config : V12.Config);
    export const UnsupportedMethodError = new Error("不支持的方法");
    export const UnsupportedVersionError = new Error("不支持的oneBot版本");
    export type Payload<V extends Version = Version> = V extends "V11" ? V11.Payload : V12.Payload;
    export type Segment<V extends Version = Version> = V extends "V11" ? V11.Segment : V12.Segment;
    export type SelfInfo<V extends Version = Version> = V extends "V11"
        ? V11.SelfInfo
        : V12.SelfInfo;
    export type GroupInfo<V extends Version> = V extends "V11" ? V11.GroupInfo : V12.GroupInfo;
    export type UserInfo<V extends Version> = V extends "V11" ? V11.UserInfo : V12.UserInfo;
    export type Message<V extends Version> = V extends "V11" ? V11.Message : V12.Message;
    export type GroupMemberInfo<V extends Version> = V extends "V11"
        ? V11.GroupMemberInfo
        : V12.GroupMemberInfo;
    export type MessageRet<V extends Version> = V extends "V11" ? V11.MessageRet : V12.MessageRet;

    export interface Base {
        app: App;
        start(path?: string): any;

        stop(): any;

        dispatch(...args: any[]): any;

        apply(...args: any[]): any;
    }
}
export const BOOLS = [
    "no_cache",
    "auto_escape",
    "as_long",
    "enable",
    "reject_add_request",
    "is_dismiss",
    "approve",
    "block",
];
