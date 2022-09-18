import {EventEmitter} from 'events'
import {App} from "./server/app";
import {deepMerge, omit} from "./utils";
import {join} from "path";
import {Client} from "icqq";
import {V11} from "./service/V11";
import {V12} from "./service/V12";
import {MayBeArray} from "./types";

export class NotFoundError extends Error{
    message='不支持的API'
}
export class OneBot<V extends OneBot.Version> extends EventEmitter{
    public config:OneBotConfig[]
    status:OneBotStatus
    protected password:string
    public client:Client
    instances:(V11|V12)[]
    constructor(public app:App,public readonly uin:number,config:MayBeArray<OneBotConfig>){
        super()
        if(!Array.isArray(config))config=new Array(config)
        this.config=(config as OneBotConfig[]).map(c=>{
            if(c.password)this.password=c.password
            if(!c.version)c.version='V11'
            switch (c.version){
                case 'V11':
                    return deepMerge(this.app.config.general.V11 as OneBotConfig,c)
                case 'V12':
                    return deepMerge(this.app.config.general.V12 as OneBotConfig,c)
                default:
                    throw new Error('不支持的oneBot版本：'+c.version)
            }
        })
        this.client=new Client(uin,{platform:this.app.config.platform,data_dir:join(App.configDir,'data')})
        this.instances=this.config.map(c=>{
            switch (c.version) {
                case 'V11':
                    return new V11(this,this.client,<V11.Config>omit(c, ['version', 'password']))
                case 'V12':
                    return new V12(this,this.client,omit(c,['version','password']))
                default:
                    throw new Error('不支持的oneBot版本：'+c.version)
            }
        })
    }
    start(){
        this.startListen()
        this.client.login(this.password)
    }
    startListen(){
        this.client.on('system',this.dispatch.bind(this))
        this.client.on('notice',this.dispatch.bind(this))
        this.client.on('request',this.dispatch.bind(this))
        this.client.on('message',this.dispatch.bind(this))
        this.instances.forEach(instance=>{
            instance.start(this.instances.length>1?'/'+instance.version:undefined)
        })
    }
    stop(){
        this.instances.forEach(instance=>{
            instance.stop()
        })
        this.client.off('system',this.dispatch.bind(this))
        this.client.off('notice',this.dispatch.bind(this))
        this.client.off('request',this.dispatch.bind(this))
        this.client.off('message',this.dispatch.bind(this))
    }
    dispatch(data){
        for(const instance of this.instances){
            instance.dispatch(data)
        }
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
        password?:string
    } & (V extends 'V11'?V11.Config:V12.Config))
    export interface Base{
        start(path?:string):any
        stop():any
        dispatch(...args:any[]):any
        apply(...args:any[]):any
    }
}
export const BOOLS = ["no_cache", "auto_escape", "as_long", "enable", "reject_add_request", "is_dismiss", "approve", "block"]
