import {EventEmitter} from 'events'
import {App} from "./server/app";
import {deepMerge, omit} from "./utils";
import {join} from "path";
import {Client} from "oicq";
import {V11} from "./service/V11";
import {V12} from "./service/V12";
import {MayBeArray} from "./types";

export class NotFoundError extends Error{
    message='不支持的API'
}
export class OneBot<V extends OneBot.Version> extends EventEmitter{
    public config:OneBotConfig[]
    status:OneBotStatus
    public client:Client
    instances:(V11|V12)[]
    constructor(public app:App,public readonly uin:number,config:MayBeArray<OneBotConfig>){
        super()
        if(!Array.isArray(config))config=new Array(config)
        this.config=(config as OneBotConfig[]).map(c=>{
            switch (c.version){
                case 'V11':
                    return deepMerge(V11.defaultConfig as OneBotConfig,c)
                case 'V12':
                    return deepMerge(V12.defaultConfig as OneBotConfig,c)
                default:
                    throw new Error('不支持的oneBot版本：'+c.version)
            }
        })
        this.client=new Client(uin,{platform:5,data_dir:join(process.cwd(),'data')})
        this.instances=this.config.map(c=>{
            switch (c.version) {
                case 'V11':
                    return new V11(this.app,this.client,omit(c,['version']))
                case 'V12':
                    return new V12(this.app,this.client,omit(c,['version']))
                default:
                    throw new Error('不支持的oneBot版本：'+c.version)
            }
        })
    }
    start(){
        this.instances.forEach(instance=>{
            instance.start(this.instances.length>1?'/'+instance.version:undefined)
        })
    }
    stop(){
        this.instances.forEach(instance=>{
            instance.stop()
        })
    }
}
export enum OneBotStatus{
    Good,
    Bad
}
export type OneBotConfig=OneBot.Config<OneBot.Version>
export namespace OneBot{
    export type Version='V11'|'V12'
    export type Config<V extends Version='V11'>=({
        version?:V
    } & (V extends 'V11'?V11.Config:V12.Config))
    export interface Base{
        start(path?:string):any
        stop():any
        dispatch(...args:any[]):any
        apply(...args:any[]):any
    }
}
export const BOOLS = ["no_cache", "auto_escape", "as_long", "enable", "reject_add_request", "is_dismiss", "approve", "block"]
