import Koa from 'koa'
import {Logger,getLogger} from "log4js";
import {join} from 'path'
import {createServer,Server} from "http";
import yaml from 'js-yaml'
import KoaBodyParser from "koa-bodyparser";
import {OneBot} from "../onebot";
import {deepMerge,deepClone} from "@/utils";
import {Router} from "./router";
import {readFileSync} from "fs";
import {LogLevel} from "@/types";
export interface KoaOptions{
    env?: string
    keys?: string[]
    proxy?: boolean
    subdomainOffset?: number
    proxyIpHeader?: string
    maxIpsCount?: number
}
export class App extends Koa{
    public config:App.Config<any>
    readonly httpServer:Server
    public logger:Logger
    accounts:OneBot<any>[]=[]
    public router:Router
    constructor(config:App.Config<any>={}) {
        super(config);
        this.config=deepMerge(deepClone(App.defaultConfig),config)
        this.logger=getLogger('[oicq-oneBot]')
        this.logger.level=this.config.log_level
        this.router=new Router({prefix:config.path})
        this.use(KoaBodyParser())
            .use(this.router.routes())
            .use(this.router.allowedMethods())
        this.httpServer=createServer(this.callback())
        this.createOneBots()
    }
    getLogger(uin:number|string,version=''){
        const logger= getLogger(`[oicq-oneBot${version}:${uin}]`)
        logger.level=this.config.log_level
        return logger
    }
    private createOneBots(){
        for(const [uin,config] of Object.entries(this.config.accounts)){
            this.createOneBot(Number(uin),config)
        }
    }
    public createOneBot(uin:number,config:OneBot.Config){
        this.accounts.push(new OneBot(this,uin,config))
    }
    start(){
        for(const bot of this.accounts){
            bot.start()
        }
        this.httpServer.listen(this.config.port)
        this.logger.mark(`server listen at http://0.0.0.0:${this.config.port}/${this.config.path?this.config.path:''}`)
    }
}
export function createApp<V extends OneBot.Version>(config:App.Config<V>|string='config.yaml'){
    if(typeof config==='string'){
        config=yaml.load(readFileSync(join(process.cwd(),config), 'utf8')) as App.Config<any>
    }
    return new App(config)
}
export function defineConfig<V extends OneBot.Version>(config:App.Config<V>){
    return config
}
export namespace App{
    // @ts-ignore
    export interface Config<V extends OneBot.Version> extends OneBot.Config<V>,KoaOptions{
        port?:number
        path?:string
        accounts?:Record<`${number}`, OneBot.Config>
        log_level?:LogLevel
    }
    export const defaultConfig:Config<any>={
        port:6727,
        log_level:'info',
        accounts:{},
    }
}
