import 'oicq2-cq-enable'
import {EventEmitter} from 'events'
import {App} from "./server/app";
import {deepMerge, omit} from "./utils";
import {join} from "path";
import {Client} from "oicq";
import {genDmMessageId,genGroupMessageId} from 'oicq/lib/message'
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
                    return new V12(this,this.client,<V12.Config>omit(c,['version','password']))
                default:
                    throw new Error('不支持的oneBot版本：'+c.version)
            }
        })
    }
    async start(){
        this.startListen()
        const disposeArr=[]
        const clean=()=>{
            while (disposeArr.length){
                disposeArr.shift()()
            }
        }
        this.client.on('system.login.qrcode',function qrcodeHelper(){
            console.log('扫码后回车继续')
            process.stdin.once('data',()=>{
                this.login()
            })
            disposeArr.push(()=>{
                this.off('system.login.qrcode',qrcodeHelper)
            })
        })
        this.client.on('system.login.device',function deviceHelper(){
            console.log('请输入密保手机接收的验证码')
            this.sendSmsCode()
            process.stdin.once('data',(e)=>{
                this.submitSmsCode(e.toString().trim())
            })
            disposeArr.push(()=>{
                this.off('system.login.device',deviceHelper)
            })
        })
        this.client.on('system.login.error',function errorHandler(e){
            if(e.message.includes('密码错误')){
                process.stdin.once('data',(e)=>{
                    this.login(e.toString().trim())
                })
            }else{
                process.exit()
            }
            this.off('system.login.error',errorHandler)
        })
        this.client.on('system.login.slider',function sliderHelper(e){
            console.log('滑块验证地址：'+e.url)
            console.log('请输入滑块验证返回的ticket')
            process.stdin.once('data',(e)=>{
                this.submitSlider(e.toString().trim())
            })
            disposeArr.push(()=>{
                this.off('system.login.slider',sliderHelper)
            })
        })
        this.client.on('system.online',clean)
        await this.client.login(this.password)
    }
    startListen(){
        this.client.on('system',this.dispatch.bind(this,'system'))
        this.client.on('notice',this.dispatch.bind(this,'notice'))
        this.client.on('request',this.dispatch.bind(this,'request'))
        this.client.on('message',this.dispatch.bind(this,'message'))
        for(const instance of this.instances){
            instance.start(this.instances.length>1?'/'+instance.version:undefined)
        }
    }
    async stop(force?:boolean){
        for(const instance of this.instances){
            await instance.stop(force)
        }
        this.client.removeAllListeners()
    }
    dispatch(event,data){
        for(const instance of this.instances){
            const result=instance.format(event,data)
            if(data.source){
                switch (data.message_type){
                    case 'group':
                        data.message.shift({
                            type:'reply',
                            message_id:genGroupMessageId(data.group_id,data.source.user_id,data.source.seq,data.source.rand,data.source.rand,data.source.time)
                        })
                        break;
                    case 'private':
                        data.message.shift({
                            type:'reply',
                            message_id:genDmMessageId(data.source.user_id,data.source.seq,data.source.rand,data.source.rand,data.source.time)
                        })
                        break;
                }
            }
            instance.dispatch(result)
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
