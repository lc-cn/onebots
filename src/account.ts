import { EventEmitter } from "events";
import { deepClone, deepMerge } from "./utils.js";
import { Adapter } from "@/adapter.js";
import { Logger } from "log4js";
import { Protocol,ProtocolRegistry } from "./protocols/index.js";

export class NotFoundError extends Error {
    message = "不支持的API";
}

export class Account<P extends keyof Adapter.Configs= keyof Adapter.Configs,C=any> extends EventEmitter {
    status: AccountStatus;
    avatar: string;
    nickname: string;
    dependency: string;
    #logger: Logger;
    protocols: Protocol[]
    get account_id() {
        return this.config.account_id;
    }
    get app() {
        return this.adapter.app;
    }

    get platform() {
        return this.adapter.platform;
    }

    get logger() {
        return (this.#logger ||= this.app.getLogger(this.account_id));
    }

    get info() {
        return {
            uin: this.account_id,
            status: this.status,
            platform: this.platform,
            avatar: this.avatar,
            nickname: this.nickname,
            dependency: this.dependency,
            urls: this.protocols.map(ins => {
                return `/${this.platform}/${this.account_id}/${ins.version}`;
            }),
        };
    }
    get protocolConfigs():Protocol.FullConfig<C>[] {
        const result: Protocol.FullConfig<C>[] = [];
        Object.keys(this.config).forEach(key=>{
            const [protocol,version]=key.split(".");
            if(ProtocolRegistry.has(protocol,version)){
                const config= this.config[key]||{};
                const general = this.app.config.general[key]||{};
                result.push({
                    ...deepMerge(deepClone(general),config),
                    protocol,
                    version
                })
            }
        });
        return result;
    }
    constructor(
        public adapter: Adapter<C>,
        public client:C,
        public config: Account.Config<P>,
    ) {
        super();

        this.protocols = this.protocolConfigs.map(({protocol,version,...config}:Protocol.FullConfig<C>) => {
            const Factory = ProtocolRegistry.get(protocol, version);
            return new Factory(this.adapter,this, config);
        });
        this.status = AccountStatus.Pending;
    }

    async start() {
        this.logger.info(`Starting account ${this.account_id}`);
        this.emit("start");
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

    getGroupList() {
        return this.adapter.getGroupList(this.account_id);
    }

    getFriendList(){
        return this.adapter.getFriendList(this.account_id);
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
    export type Config<P extends keyof Adapter.Configs = keyof Adapter.Configs> = Adapter.Configs[P] & Partial<Protocol.Configs> & {
        platform: string;
        account_id:string
    }
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
