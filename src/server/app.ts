import Koa from 'koa'
import {Logger,getLogger} from "log4js";
import {join} from 'path'
import {createServer,Server} from "http";
import yaml from 'js-yaml'
import KoaBodyParser from "koa-bodyparser";
import {OneBot} from "@/onebot";
import {deepMerge,deepClone} from "@/utils";
import {Router} from "./router";
import {readFileSync} from "fs";
export interface KoaOptions{
    env?: string
    keys?: string[]
    proxy?: boolean
    subdomainOffset?: number
    proxyIpHeader?: string
    maxIpsCount?: number
}
export class App extends Koa{
    public config:App.Config
    readonly httpServer:Server
    public logger:Logger
    bots:OneBot[]=[]
    public router:Router
    constructor(config:App.Config={}) {
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
    getLogger(uin:number){
        return getLogger(`[oicq-oneBot:${uin}]`)
    }
    private createOneBots(){
        for(const [uin,config] of Object.entries(this.config.bots)){
            this.createOneBot(Number(uin),config)
        }
    }
    public createOneBot(uin:number,config:OneBot.Config){
        this.bots.push(new OneBot(this,uin,config))
    }
    start(){
        for(const bot of this.bots){
            bot.start()
        }
        this.httpServer.listen(this.config.port)
        this.logger.mark(`server listen at http://0.0.0.0:${this.config.port}/${this.config.path?this.config.path:''}`)
    }
}
export function createApp(config:App.Config|string='config.yaml'){
    if(typeof config==='string'){
        config=yaml.load(readFileSync(join(process.cwd(),config), 'utf8')) as App.Config
    }
    return new App(config)
}
export function defineConfig(config:App.Config){
    return config
}
export namespace App{
    export interface Config extends OneBot.Config,KoaOptions{
        port?:number
        path?:string
        bots?:Record<`${number}`, OneBot.Config>
    }
    export const defaultConfig:Config={
        port:6727,
        log_level:'info',
        version:11,
        bots:{},
        heartbeat:3,
        http:true,
        http_reverse:[],
        ws:{
            reconnect_interval:3
        },
        ws_reverse:[]
    }
}
