import { EventEmitter } from "events";
import { deepClone, deepMerge } from "./utils";
import { Adapter,AdapterClient } from "@/adapter";
import { Logger } from "log4js";
import { Protocol,ProtocolRegistry } from "./protocols";

export class NotFoundError extends Error {
    message = "不支持的API";
}

export class Account<C=any, V extends Account.Config = Account.Config> extends EventEmitter {
    public config: V[];
    status: AccountStatus;
    avatar: string;
    nickname: string;
    dependency: string;
    #logger: Logger;
    protected password: string;
    client: C;
    protocols: Protocol[]

    get app() {
        return this.adapter.app;
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
            urls: this.protocols.map(ins => {
                return `/${this.platform}/${this.uin}/${ins.version}`;
            }),
        };
    }

    constructor(
        public adapter: Adapter<C>,
        public readonly uin: string,
        version_configs: Account.Config[],
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
                    throw new Error("不支持的Account版本：" + c.version);
            }
        });
        this.protocols = this.config.map((c:V) => {
            const Factory = ProtocolRegistry.get(c.protocol, c.version);
            return new Factory(this.adapter,this, c);
        });
        this.status = AccountStatus.Pending;
    }

    async start() {
        for (const protocol of this.protocols) {
            protocol.start();
        }
    }

    async stop(force?: boolean) {
        for (const protocol of this.protocols) {
            await protocol.stop(force);
        }
        this.emit("stop");
    }

    getGroupList<V extends Account.Version>() {
        return this.adapter.getGroupList(this.uin);
    }

    getFriendList<V extends Account.Version>(){
        return this.adapter.getFriendList(this.uin);
    }

    async dispatch(commonEvent: any) {
        // Each protocol instance formats the common event to its own standard
        for (const protocol of this.protocols) {
            protocol.dispatch(commonEvent);
        }
    }
}

export enum AccountStatus {
    Pending = "pending", // 上线中
    Online = "online", // 已上线
    OffLine = "offline", // 已离线
}

export namespace Account {
    export type Filters = {};
    export type Version = "V11" | "V12";
    export type Config<P extends string=string,V extends string=string> = {
        version: V;
        protocol: P;
        // filters?: Service.Filters;
    } & Protocol.ConfigMaps[P][V];
    export const UnsupportedMethodError = new Error("不支持的方法");
    export const UnsupportedVersionError = new Error("不支持的Account版本");
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
