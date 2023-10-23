
import {EventEmitter} from 'events'
import {deepClone, deepMerge} from "./utils";
import {V11} from "./service/V11";
import {V12} from "./service/V12";
import {Adapter} from "@/adapter";
import {Service} from "@/service";

export class NotFoundError extends Error {
    message = '不支持的API'
}

export class OneBot<V extends OneBot.Version=OneBot.Version> extends EventEmitter {
    public config: OneBot.Config[]
    status: OneBotStatus
    protected password: string
    internal?:any
    instances: (V11 | V12)[]
    get app(){
        return this.adapter.app
    }
    get platform(){
        return this.adapter.platform
    }
    get isOnline(){
        return this.adapter.getStatus(this.uin) === OneBotStatus.Online
    }
    constructor(public adapter:Adapter, public readonly uin: string, version_configs: OneBot.Config[]) {
        super()

        this.config = version_configs.map(c => {
            if (!c.version) c.version = 'V11'
            switch (c.version) {
                case 'V11':
                    return deepMerge(deepClone(this.adapter.app.config.general.V11), c)
                case 'V12':
                    return deepMerge(deepClone(this.adapter.app.config.general.V12), c)
                default:
                    throw new Error('不支持的oneBot版本：' + c.version)
            }
        })
        this.instances = this.config.map(c => {
            switch (c.version) {
                case 'V11':
                    return new V11(this, c as OneBot.Config<'V11'>)
                case 'V12':
                    return new V12(this, c as OneBot.Config<'V12'>)
                default:
                    throw new Error('不支持的oneBot版本：' + c.version)
            }
        })
        this.status = OneBotStatus.Good
    }

    async start() {
        for(const instance of this.instances){
            instance.start()
        }
        return await this.adapter.start()
    }


    async stop(force?: boolean) {
        for (const instance of this.instances) {
            await instance.stop(force)
        }
    }
    getGroupList<V extends OneBot.Version>(version:V):Promise<OneBot.GroupInfo<V>[]>{
        return this.adapter.getGroupList(this.uin,version)
    }
    getFriendList<V extends OneBot.Version>(version:V):Promise<OneBot.UserInfo<V>[]>{
        return this.adapter.getFriendList(this.uin,version)
    }

    async dispatch(event, data) {
        for (const instance of this.instances) {
            instance.dispatch(instance.format(event, this.adapter.payload(data)))
        }
    }
}

export enum OneBotStatus {
    Good,
    Bad,
}

export namespace OneBot {
    export type Filters = {

    }
    export type Version = 'V11' | 'V12'
    export type Config<V extends Version=Version> = {
        version?: V
        filters?:Service.Filters
    } & (V extends 'V11' ? V11.Config:V12.Config)
    export type GroupInfo<V extends Version>=V extends 'V11' ? V11.GroupInfo:V12.GroupInfo
    export type UserInfo<V extends Version>=V extends 'V11' ? V11.UserInfo:V12.UserInfo
    export type Message<V extends Version>=V extends 'V11' ? V11.Message:V12.Message
    export type MessageElement<V extends Version>=V extends 'V11' ? V11.MessageElement:V12.MessageElement
    export type GroupMemberInfo<V extends Version>=V extends 'V11' ? V11.GroupMemberInfo:V12.GroupMemberInfo
    export type MessageRet<V extends Version>=V extends 'V11' ? V11.MessageRet:V12.MessageRet
    export interface Base {
        start(path?: string): any

        stop(): any
        dispatch(...args: any[]): any

        apply(...args: any[]): any
    }
}
export const BOOLS = ["no_cache", "auto_escape", "as_long", "enable", "reject_add_request", "is_dismiss", "approve", "block"]
