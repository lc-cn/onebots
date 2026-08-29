import { EventEmitter } from "node:events";
import { deepClone, deepMerge } from "./utils.js";
import { Adapter } from "./adapter.js";
import { Logger } from "log4js";
import { ProtocolRegistry } from "./registry.js";
import { Protocol } from "./protocol.js";
import { CommonEvent } from "./types.js";

export class NotFoundError extends Error {
    message = "不支持的API";
}

export class Account<P extends keyof Adapter.Configs= keyof Adapter.Configs,C=unknown> extends EventEmitter {
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
        return (this.#logger ||= this.app.getLogger(String(this.platform)));
    }

    get info() {
        return {
            uin: this.account_id,
            status: this.status,
            platform: this.platform,
            avatar: this.avatar,
            nickname: this.nickname,
            dependency: this.dependency,
            urls: this.protocols.map(protocol => protocol.path),
        };
    }
    get protocolConfigs():Protocol.FullConfig<C>[] {
        const result: Protocol.FullConfig<C>[] = [];
        Object.keys(this.config).forEach(key=>{
            const [protocol,version]=key.split(".");
            if(ProtocolRegistry.has(protocol,version)){
                const config= this.config[key]||{};
                const general = this.app.config.general[key]||{};
                const merged = deepMerge(deepClone(general),config) as Record<string, unknown>;
                result.push({
                    ...merged,
                    protocol,
                    version
                } as Protocol.FullConfig<C>)
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
            const instance = ProtocolRegistry.create(protocol, version,this.adapter, this, config);
            // 调试观测用的旁路监听器：绝不能抛出，否则会阻断在它之后注册的同一 "dispatch" 事件的
            // 其它监听器（比如协议自身真正向客户端广播的监听器）。
            instance.on("dispatch", (data: unknown) => {
                try {
                    this.adapter.emit("message:protocol-dispatch", {
                        platform: this.platform,
                        account_id: this.account_id,
                        protocol: instance.name,
                        version: instance.version,
                        data,
                    });
                } catch (error) {
                    this.logger.debug(`message:protocol-dispatch 旁路监听器异常（已忽略）:`, error);
                }
            });
            return instance;
        });
        this.status = AccountStatus.Pending;
    }
    get path(){
        return `/${this.platform}/${this.account_id}`;
    }

    async start() {
        this.logger.info(`Starting account ${this.account_id}`);
        this.emit("start");
        for (const protocol of this.protocols) {
            await protocol.start();
        }
    }

    async stop(force?: boolean) {
        for (const protocol of this.protocols) {
            await protocol.stop(force);
        }
        this.emit("stop");
        this.removeAllListeners();
    }

    getGroupList() {
        return this.adapter.getGroupList(this.account_id);
    }

    getFriendList(){
        return this.adapter.getFriendList(this.account_id);
    }

    /**
     * 将通用事件同步派发到本账号绑定的各协议（协议内自行 catch，避免一次失败阻断其它协议）
     */
    dispatch(commonEvent: CommonEvent.Base): void {
        this.logger.debug(`Dispatching event: ${commonEvent.type} to ${this.protocols.length} protocol(s)`);
        // 调试观测用的旁路 emit：绝不能抛出并阻断下面真正的协议分发循环。
        try {
            this.adapter.emit("message:dispatch", {
                platform: this.platform,
                account_id: this.account_id,
                event: commonEvent,
            });
        } catch (error) {
            this.logger.debug(`message:dispatch 旁路监听器异常（已忽略）:`, error);
        }
        for (const protocol of this.protocols) {
            this.logger.debug(`Dispatching to protocol: ${protocol.name}/${protocol.version}`);
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
