import {Client} from "oicq";
import {OneBotV11} from "./onebotV11";
import {OneBotV12} from "./onebotV12";
export class Service<V extends Service.Version> {
    private service:OneBotV11|OneBotV12
    constructor(public client:Client,private version:V) {
        switch (version){
            case 11:
                this.service=new OneBotV11()
                break;
            case 12:
                this.service=new OneBotV12()
                break;
            default:
                throw new Error('不受支持的OneBot版本')
        }
    }
    apply<K extends keyof Service.Current<V>>(method:K,...params:Parameters<Service.Current<V>[K]>):Service.Result<ReturnType<Service.Current<V>[K]>>{
        try{
            // @ts-ignore
            const res=this.service[method].apply(this.client,params)
            return {retcode:0,data:res,success:true}
        }catch (e){
            return {
                retcode:1,
                success:false,
                msg:e.message
            }
        }
    }
}
export namespace Service{
    export type Version=11|12
    export interface Result<T extends any>{
        retcode:number
        success?:boolean
        msg?:string
        data?:T
    }
    export type Current<V extends Version>=V extends 11?OneBotV11:OneBotV12
    export type Base=Record<string, (...args:any[])=>any>
}
