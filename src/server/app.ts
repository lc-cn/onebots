import Koa from 'koa'
import * as os from 'os'
import "reflect-metadata";
import {copyFileSync, existsSync, mkdirSync, writeFileSync} from "fs";
import {Logger, getLogger} from "log4js";
import {createServer, Server} from "http";
import yaml from 'js-yaml'
import KoaBodyParser from "koa-bodyparser";
import {OneBot} from "@/onebot";

const mime = require('mime-types');
import {deepMerge, deepClone, protectedFields, Class} from "@/utils";
import {Router} from "./router";
import {readFileSync} from "fs";
import {V11} from "@/service/V11";
import {V12} from "@/service/V12";
import {LogLevel, MayBeArray} from "@/types";
import {Platform} from "icqq";
import * as path from "path";
import {Adapter} from "@/adapter";

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
    public config: App.Config
    readonly httpServer: Server
    public logger: Logger
    static configDir = path.join(os.homedir(), '.onebots')
    static configPath = path.join(App.configDir, 'config.yaml')
    adapters:Map<string,Adapter>=new Map<string, Adapter>()
    public router: Router

    constructor(config: App.Config = {}) {
        super(config);
        this.config = deepMerge(deepClone(App.defaultConfig), config)
        this.logger = getLogger('[OneBots]')
        this.logger.level = this.config.log_level
        this.router = new Router({prefix: config.path})
        this.use(KoaBodyParser())
            .use(this.router.routes())
            .use(this.router.allowedMethods())
        this.httpServer = createServer(this.callback())
        this.createOneBots()
    }

    getLogger(patform:string) {
        const logger = getLogger(`[OneBots:${patform}]`)
        logger.level = this.config.log_level
        return logger
    }

    private getConfigMaps() {
        const result: Map<string, Adapter.Config> = new Map<string, Adapter.Config>()
        Object.entries(this.config).forEach(([key, value]) => {
            if (!App.configKeys.includes(key)) {
                result.set(key, value)
            }
        })
        return result
    }

    private createOneBots() {
        for (const [uin, config] of this.getConfigMaps()) {
            this.createOneBot(uin, config)
        }
    }

    public addAccount<P extends string>(platform: P, uin: string, config: Adapter.Configs[P]) {
        this.config[uin] = config
        const oneBot = this.createOneBot(uin, config)
        oneBot.start()
        writeFileSync(App.configPath, yaml.dump(deepClone(this.config)))
    }

    public updateAccount<P extends string>(platform: P, uin: string, config: Adapter.Configs[P]) {
        const adapter=this.findOrCreateAdapter(config)
        const oneBot=adapter.oneBots.get(uin)
        if (!oneBot) return this.addAccount(platform, uin, config)
        const newConfig = deepMerge(this.config[uin], config)
        this.removeAccount(platform, uin)
        this.addAccount(platform, uin, newConfig)
    }

    public removeAccount(platform: string, uin: string, force?: boolean) {
        const adapter = this.findOrCreateAdapter(this.config[platform])
        const oneBot=adapter.oneBots.get(uin)
        if(!oneBot) throw new Error(`未找到账号${uin}`)
        oneBot.stop(force)
        delete this.config[uin]
        adapter.oneBots.delete(uin)
        writeFileSync(App.configPath, yaml.dump(this.config))
    }

    public createOneBot<P extends string>(uin: string, config: Adapter.Config<P>) {
        const adapter = this.findOrCreateAdapter<P>(config)
        return adapter.createOneBot(uin,config.protocol,config.versions)
    }
    get oneBots(){
        return [...this.adapters.values()].map((adapter)=>{
            return [...adapter.oneBots.values()]
        }).flat()
    }
    public findOrCreateAdapter<P extends string>(config:Adapter.Config<P>){
        if(this.adapters.has(config.platform)) return this.adapters.get(config.platform)
        const platform = config.platform
        const AdapterClass = App.ADAPTERS.get(platform)
        if (!AdapterClass) throw new Error(`未安装适配器(${platform})`)
        const adapter = new AdapterClass(this, platform, config)
        this.adapters.set(config.platform, adapter)
        return adapter
    }

    async start() {
        this.httpServer.listen(this.config.port)
        this.router.get('/list', (ctx) => {
            ctx.body = this.oneBots.map(bot => {
                return {
                    uin: bot.uin,
                    config: bot.config.map(c => protectedFields(c, "access_token")),
                    urls: bot.config.map(c => `/${c.version}/${bot.uin}`)
                }
            })
        })
        this.router.get('/qrcode', (ctx) => {
            const {uin} = ctx.query
            const uinUrl = path.join(App.configDir, 'data', uin as string)
            if (!existsSync(uinUrl)) {
                return ctx.res.writeHead(400).end('未登录')
            }
            const qrcodePath = path.join(App.configDir, 'data', uin as string, 'qrcode.png')
            let file = null;
            try {
                file = readFileSync(qrcodePath); //读取文件
            } catch (error) {
                return ctx.res.writeHead(404).end(error.message)
            }
            let mimeType = mime.lookup(qrcodePath); //读取图片文件类型
            ctx.set('content-type', mimeType); //设置返回类型
            ctx.body = file; //返回图片
        })
        this.router.get('/detail', (ctx) => {
            let {uin} = ctx.request.query
            const oneBot = this.oneBots.find(bot => bot.uin === String(uin))
            ctx.body = {
                uin,
                config: oneBot.config.map(c => protectedFields(c, "access_token")),
                urls: oneBot.config.map(c => `/${uin}/${c.version}`)
            }
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
}

export function createOnebots(config: App.Config | string = 'config.yaml') {
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
    return new App(config)
}

export function defineConfig(config: App.Config) {
    return config
}

export namespace App {
    export const ADAPTERS: Map<string, AdapterClass> = new Map()
    export const configKeys:string[]=[
        'port',
        'path',
        'timeout',
        'log_level',
        'general',
        'env',
        'keys',
        'proxy',
        'subdomainOffset',
        'proxyIpHeader',
    ]
    export interface Adapters<P extends string = string> extends Map<P, Adapter<P>> {
    }

    export type Config = {
        port?: number
        path?: string
        timeout?: number
        log_level?: LogLevel
        general?: {
            V11?: V11.Config
            V12?: V12.Config
        }
    } & KoaOptions & Record<`${number}`, MayBeArray<OneBot.Config<OneBot.Version>>>
    export const defaultConfig: Config = {
        port: 6727,
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
