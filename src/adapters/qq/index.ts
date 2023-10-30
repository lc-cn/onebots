import axios from "axios";
import WebSocket from "ws";
import {Adapter} from "@/adapter";
import {App} from "@/server/app";
import {OneBot, OneBotStatus} from "@/onebot";
import {QQBot} from "@/adapters/qq/bot";

export default class QQAdapter extends Adapter<'qq'>{
    constructor(app:App,config:QQAdapter.Config) {
        super(app,'qq',config);
    }
    #disposes:Map<string,Function>=new Map<string, Function>()
    async startOneBot(oneBot:OneBot){
        const config:QQAdapter.Config['protocol']=this.app.config[`qq.${oneBot.uin}`].protocol as any
        const qqBot=oneBot.internal=new QQBot(oneBot,oneBot.uin,config)
        await qqBot.init()
        const disposeArr:Function[]=[]
        const clean=()=>{
            while (disposeArr.length>0){
                disposeArr.pop()()
            }
            qqBot.stop()
        }
        return clean
    }
    async start(uin:string){
        const startOneBots=[...this.oneBots.values()].filter(oneBot=>{
            return uin?oneBot.uin===uin:true
        })
        for(const oneBot of startOneBots){
            this.#disposes.set(oneBot.uin,await this.startOneBot(oneBot))
        }
        const {protocol}=this.config
        await super.start()
    }
    async stop(uin?:string){
        const stopOneBots=[...this.oneBots.values()].filter(oneBot=>{
            return uin?oneBot.uin===uin:true
        })
        for(const oneBot of stopOneBots){
            const dispose=this.#disposes.get(oneBot.uin)
            if(dispose){
                dispose()
            }
        }
        await super.stop()
    }
    getSelfInfo<V extends OneBot.Version>(uin: string, version: V): OneBot.SelfInfo<V> {
        return {
            nickname: 'qq',
            status: OneBotStatus.Online,
        } as OneBot.SelfInfo<V>;
    }
}
declare module '@/adapter'{
    export namespace Adapter{
        export interface Configs{
            qq: QQAdapter.Config
        }
    }
}
export namespace QQAdapter{
    export interface Config extends Adapter.Config<'qq'>{
        protocol:{
            secret:string
            sandbox?:boolean
            maxRetry?:number
            intents?:string[]
        }
    }
}
