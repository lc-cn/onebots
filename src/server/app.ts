import Koa from 'koa'
import * as os from 'os'
import "reflect-metadata";
import {copyFileSync, existsSync, mkdirSync, writeFileSync} from "fs";
import {Logger, getLogger,configure} from "log4js";
import {createServer, Server} from "http";
import koaStatic from 'koa-static'
import yaml from 'js-yaml'
import KoaBodyParser from "koa-bodyparser";
import basicAuth from 'koa-basic-auth'

import { deepMerge, deepClone, protectedFields, Class, readLine } from "@/utils";
import { Router, WsServer } from "./router";
import {readFileSync} from "fs";
import {V11} from "@/service/V11";
import {V12} from "@/service/V12";
import {LogLevel} from "@/types";
import * as path from "path";
import {Adapter} from "@/adapter";
import { ChildProcess } from "child_process";
import process from "process";
import * as fs from "fs";
import { Dict } from "@zhinjs/shared";
export interface KoaOptions {
    env?: string
    keys?: string[]
    proxy?: boolean
    subdomainOffset?: number
    proxyIpHeader?: string
    maxIpsCount?: number
}

type AdapterClass = Class<Adapter>

export class App extends Koa {
    public config: Required<App.Config>
    public httpServer: Server
    public logger: Logger
    static configDir = path.join(os.homedir(), '.onebots')
    static configPath = path.join(App.configDir, 'config.yaml')
    adapters:Map<string,Adapter>=new Map<string, Adapter>()
    public ws:WsServer
    public router: Router
    static logFile=path.join(process.cwd(),'onebots.log')
    get info(){
        const pkg=require(path.resolve(__dirname,'../../package.json'))
        const free_memory=os.freemem()
        const total_memory=os.totalmem()
        return {
            system_platform:process.platform,
            system_arch:process.arch,
            system_cpus:os.cpus(),
            system_version:os.version(),
            system_uptime:os.uptime()*1000,
            username:os.userInfo().username,
            total_memory,
            free_memory,
            process_id:process.pid,
            process_parent_id:process.ppid,
            process_cwd:process.cwd(),
            process_use_memory:process.memoryUsage.rss(),
            node_version:process.version,
            sdk_version:pkg.version,
            uptime:process.uptime()*1000
        }
    }
    constructor(config: App.Config = {}) {
        super(config);

        this.config = deepMerge(deepClone(App.defaultConfig), config)
        this.init()
    }

    init(){
        this.logger = getLogger('[OneBots]')
        this.logger.level = this.config.log_level
        this.router = new Router({prefix: this.config.path})
        this
            .use(KoaBodyParser())
            .use(this.router.routes())
            .use(this.router.allowedMethods())
            .use(basicAuth({
                name:this.config.username,
                pass:this.config.password
            }))
            .use(koaStatic(path.resolve(__dirname,'../../dist')))
        this.httpServer = createServer(this.callback())
        this.ws=this.router.ws('/',this.httpServer)

        this.createOneBots()
    }
    getLogger(patform:string) {
        const logger = getLogger(`[OneBots:${patform}]`)
        logger.level = this.config.log_level
        return logger
    }

    private getConfigMaps() {
        type AdapterInfo=[string,string,Adapter.Config]
        const result:AdapterInfo[]=[]
        for(const [key,value] of Object.entries(this.config)){
            const [adapter,...uinArr]=key.split('.')
            const uin=uinArr.join('.')
            if(!uin) continue
            result.push([adapter,uin,value as Adapter.Config])
        }
        return result
    }

    private createOneBots() {
        for (const [platform,uin, config] of this.getConfigMaps()) {
            this.createOneBot(platform,uin, config)
        }
    }

    public addAccount<P extends string>(platform: P, uin: string, config: Adapter.Configs[P]) {
        this.config[`${platform}.${uin}`] = config
        const oneBot = this.createOneBot(platform,uin, config)
        oneBot.start()
        writeFileSync(App.configPath, yaml.dump(deepClone(this.config)))
    }

    public updateAccount<P extends string>(platform: P, uin: string, config: Adapter.Configs[P]) {
        const adapter=this.findOrCreateAdapter(platform)
        if(!adapter) return
        const oneBot=adapter.oneBots.get(uin)
        if (!oneBot) return this.addAccount(platform, uin, config)
        const newConfig = deepMerge(this.config[uin], config)
        this.removeAccount(platform, uin)
        this.addAccount(platform, uin, newConfig)
    }

    public removeAccount(platform: string, uin: string, force?: boolean) {
        const adapter = this.findOrCreateAdapter(platform)
        if(!adapter) return
        const oneBot=adapter.oneBots.get(uin)
        if(!oneBot) return this.logger.warn(`未找到账号${uin}`)
        oneBot.stop(force)
        delete this.config[`${platform}.${uin}`]
        adapter.oneBots.delete(uin)
        writeFileSync(App.configPath, yaml.dump(this.config))
    }

    public createOneBot<P extends string>(platform : P,uin: string, config: Adapter.Config) {
        const adapter = this.findOrCreateAdapter<P>(platform,config)
        if(!adapter) return
        return adapter.createOneBot(uin,config.protocol,config.versions)
    }
    get oneBots(){
        return [...this.adapters.values()].map((adapter)=>{
            return [...adapter.oneBots.values()]
        }).flat()
    }
    public findOrCreateAdapter<P extends string>(platform:P,config?:Adapter.Config){
        if(this.adapters.has(platform)) return this.adapters.get(platform)
        const AdapterClass = App.ADAPTERS.get(platform)
        if (!AdapterClass) return this.logger.warn(`未安装适配器(${platform})`)
        const adapter = new AdapterClass(this, config)
        this.adapters.set(platform, adapter)
        return adapter
    }

    async start() {
        this.httpServer.listen(this.config.port)
        const fileListener=(e)=>{
            if(e==='change') this.ws.clients.forEach(client=>{
                client.send(JSON.stringify({
                    event:'system.log',
                    data:fs.readFileSync(App.logFile,'utf8')
                }))
            })
        }
        fs.watch(App.logFile,fileListener)
        this.on('close',()=>{
            fs.unwatchFile(App.logFile,fileListener)
        })
        process.on('disconnect',()=>{
            fs.unwatchFile(App.logFile,fileListener)
        })
        this.ws.on('connection',async (client)=>{
            client.send(JSON.stringify({
                event:'system.sync',
                data:{
                    config:fs.readFileSync(App.configPath,'utf8'),
                    adapters:[...this.adapters.values()].map(adapter=>{
                        return adapter.info
                    }),
                    app:this.info,
                    logs:fs.existsSync(App.logFile) ? await readLine(100,App.logFile,'utf8'):''
                }
            }))
            client.on('message',async (raw)=>{
                let payload:Dict={}
                try{
                    payload=JSON.parse(raw.toString())
                }catch {
                    return
                }
                switch (payload.action){
                    case 'system.input':
                        return process.stdin.write(`${payload.data}\n`)
                    case 'system.saveConfig':
                        return fs.writeFileSync(App.configPath,payload.data,'utf8')
                    case 'system.reload':
                        const config=yaml.load(fs.readFileSync(App.configPath,'utf8'))
                        return this.reload(config)
                    case 'bot.start':{
                        const {platform,uin}=JSON.parse(payload.data)
                        await this.adapters.get(platform)?.setOnline(uin)
                        return client.send(JSON.stringify({
                            event:'bot.change',
                            data:this.adapters.get(platform).getOneBot(uin).info
                        }))
                    }
                    case 'bot.stop':{
                        const {platform,uin}=JSON.parse(payload.data)
                        await this.adapters.get(platform)?.setOffline(uin)
                        return client.send(JSON.stringify({
                            event:'bot.change',
                            data:this.adapters.get(platform).getOneBot(uin).info
                        }))
                    }
                }
            })
        })
        this.router.get('/list', (ctx) => {
            ctx.body = this.oneBots.map(bot => {
                return bot.info
            })
        })
        this.router.post('/add', (ctx, next) => {
            const {uin, ...config} = (ctx.request.body || {}) as any
            try {
                this.addAccount(config.platform, uin, config)
                ctx.body = `添加成功`
            } catch (e) {
                ctx.body = e.message
            }
        })
        this.router.post('/edit', (ctx, next) => {
            const {uin, ...config} = (ctx.request.body || {}) as any
            try {
                this.updateAccount(config.platform, uin, config)
                ctx.body = `修改成功`
            } catch (e) {
                ctx.body = e.message
            }
        })
        this.router.get('/remove', (ctx, next) => {
            const {uin, platform, force} = ctx.request.query
            try {
                this.removeAccount(String(platform), String(uin), Boolean(force))
                ctx.body = `移除成功`
            } catch (e) {
                console.log(e)
                ctx.body = e.message
            }
        })
        process.on('uncaughtException', (e) => {
            console.error('uncaughtException', e)
        })
        process.on('unhandledRejection', (e) => {
            console.error('unhandledRejection', e)
        })
        this.logger.mark(`server listen at http://0.0.0.0:${this.config.port}/${this.config.path ? this.config.path : ''}`)
        for (const [_,adapter] of this.adapters) {
            await adapter.start()
        }
    }
    async reload(config:App.Config){
        await this.stop()
        this.config=deepMerge(deepClone(App.defaultConfig), config)
        this.createOneBots()
        await this.start()
    }
    async stop(){
        for(const [_,adapter] of this.adapters){
            await adapter.stop()
        }
        this.adapters.clear()
        // this.ws.close()
        this.httpServer.close()
        this.emit('close')
    }
}

export function createOnebots(config: App.Config | string = 'config.yaml',cp:ChildProcess|null) {
    if (typeof config === 'string') {
        config = path.resolve(process.cwd(), config)
        App.configDir = path.dirname(config)
        App.configPath = config
        if (!existsSync(App.configDir)) {
            mkdirSync(App.configDir)
        }
        App.configPath = path.resolve(App.configDir, config)
        if (!existsSync(App.configPath)) {
            copyFileSync(path.resolve(__dirname, '../config.sample.yaml'), App.configPath)
            console.log('未找到对应配置文件，已自动生成默认配置文件，请修改配置文件后重新启动')
            console.log(`配置文件在:  ${App.configPath}`)
            process.exit()
        }
        config = yaml.load(readFileSync(App.configPath, 'utf8')) as App.Config
    }
    configure({
        appenders:{
            out:{
                type:'stdout',
                layout:{type:'colored'}
            },
            files:{
                type:'file',
                filename:path.join(process.cwd(),'onebots.log')
            }
        },
        categories:{
            default:{
                appenders:['out','files'],
                level:config.log_level||"info"
            }
        },
        disableClustering:true
    })
    if(cp) process.on('disconnect',()=>cp.kill())
    return  new App(config)
}

export function defineConfig(config: App.Config) {
    return config
}

export namespace App {
    export const ADAPTERS: Map<string, AdapterClass> = new Map()
    export interface Adapters<P extends string = string> extends Map<P, Adapter<P>> {
    }

    export type Config = {
        port?: number
        path?: string
        timeout?: number
        username?:string
        password?:string
        log_level?: LogLevel
        general?: {
            V11?: V11.Config
            V12?: V12.Config
        }
    } & KoaOptions & Record<`${string}.${string}`, Adapter.Config>
    export const defaultConfig: Config = {
        port: 6727,
        username:'admin',
        password:'123456',
        timeout: 30,
        general: {
            V11: V11.defaultConfig,
            V12: V12.defaultConfig,
        },
        log_level: 'info',
    }

    export function registerAdapter(name: string): void
    export function registerAdapter<T extends string>(platform: T, adapter: AdapterClass): void
    export function registerAdapter<T extends string>(platform: T, adapter?: AdapterClass) {
        if (!adapter) adapter = App.loadAdapter(platform)
        if (ADAPTERS.has(platform)) {
            console.warn(`已存在对应的适配器：${platform}`)
            return this
        }
        ADAPTERS.set(platform, adapter)
    }

    export function loadAdapter<T extends string>(platform: string) {
        const maybeNames = [
            path.join(__dirname, '../adapters', platform), // 内置的
            `@onebots/adapter-${platform}`, // 我写的
            `onebots-adapter-${platform}`, // 别人按照规范写的
            platform // 别人写的
        ]
        type AdapterClass = Class<Adapter<T>>
        let adapter: AdapterClass = null
        for (const adapterName of maybeNames) {
            try {
                adapter = require(adapterName)?.default
                break
            } catch {}
        }
        if (!adapter) throw new Error(`找不到对应的适配器：${platform}`)
        return adapter
    }
}
