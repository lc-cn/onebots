import 'icqq-cq-enable'
import {EventEmitter} from 'events'
import {App} from "./server/app";
import {deepClone, deepMerge, omit} from "./utils";
import {join} from "path";
import {Client} from "icqq";
import {genDmMessageId, genGroupMessageId} from 'icqq/lib/message'
import {V11} from "./service/V11";
import {V12} from "./service/V12";
import {MayBeArray} from "./types";
import * as process from "process";

export class NotFoundError extends Error {
    message = '不支持的API'
}

export class OneBot<V extends OneBot.Version> extends EventEmitter {
    public config: OneBotConfig[]
    status: OneBotStatus
    protected password: string
    public client: Client
    instances: (V11 | V12)[]

    constructor(public app: App, public readonly uin: number, config: MayBeArray<OneBotConfig>) {
        super()
        config = [].concat(config)
        this.config = config.map(c => {
            if (c.password) this.password = c.password
            if (!c.version) c.version = 'V11'
            switch (c.version) {
                case 'V11':
                    return deepMerge(deepClone(this.app.config.general.V11), c)
                case 'V12':
                    return deepMerge(deepClone(this.app.config.general.V12), c)
                default:
                    throw new Error('不支持的oneBot版本：' + c.version)
            }
        })
        this.client = new Client({platform: this.app.config.platform, data_dir: join(App.configDir, 'data')})
        this.instances = this.config.map(c => {
            switch (c.version) {
                case 'V11':
                    return new V11(this, this.client, <V11.Config>omit(c, ['version', 'password']))
                case 'V12':
                    return new V12(this, this.client, <V12.Config>omit(c, ['version', 'password']))
                default:
                    throw new Error('不支持的oneBot版本：' + c.version)
            }
        })
    }

    async start() {
        this.startListen()
        const disposeArr = []
        const clean = () => {
            while (disposeArr.length) {
                disposeArr.shift()()
            }
        }
        this.client.trap('system.login.qrcode', function qrcodeHelper() {
            console.log('扫码后回车继续')
            process.stdin.once('data', () => {
                this.login()
            })
            disposeArr.push(() => {
                this.off('system.login.qrcode', qrcodeHelper)
            })
        })
        this.client.trap('system.login.device', function deviceHelper(e) {
            console.log('请选择验证方式：1.短信验证  2.url验证')
            this.sendSmsCode()
            process.stdin.once('data', (buf) => {
                const input=e.toString().trim()
                if(input==='1') {
                    this.sendSmsCode()
                    console.log('请输入短信验证码:')
                    process.stdin.once('data',buf=>{
                        this.submitSmsCode(buf.toString().trim())
                    })
                }else{
                    console.log(`请前往：${e.url} 完成验证后回车继续`)
                    process.stdin.once('data',buf=>{
                        this.login()
                    })
                }
            })
            disposeArr.push(() => {
                this.off('system.login.device', deviceHelper)
            })
        })
        this.client.trap('system.login.error', function errorHandler(e) {
            if (e.message.includes('密码错误')) {
                process.stdin.once('data', (e) => {
                    this.login(e.toString().trim())
                })
            } else {
                process.exit()
            }
            this.off('system.login.error', errorHandler)
        })
        this.client.trap('system.login.slider', function sliderHelper(e) {
            console.log('滑块验证地址：' + e.url)
            console.log('请输入滑块验证返回的ticket')
            process.stdin.once('data', (e) => {
                this.submitSlider(e.toString().trim())
            })
            disposeArr.push(() => {
                this.off('system.login.slider', sliderHelper)
            })
        })
        this.client.trap('system.online', clean)
        await this.client.login(this.uin, this.password)
    }

    startListen() {
        this.client.trap('system', this.dispatch.bind(this, 'system'))
        this.client.trap('notice', this.dispatch.bind(this, 'notice'))
        this.client.trap('request', this.dispatch.bind(this, 'request'))
        this.client.trap('message', this.dispatch.bind(this, 'message'))
        for (const instance of this.instances) {
            instance.start(this.instances.length > 1 ? '/' + instance.version : undefined)
        }
    }

    async stop(force?: boolean) {
        for (const instance of this.instances) {
            await instance.stop(force)
        }
        this.client.logout(force)
    }

    dispatch(event, data) {
        for (const instance of this.instances) {
            const result = instance.format(event, data)
            if (data.source) {
                switch (data.message_type) {
                    case 'group':
                        data.message.shift({
                            type: 'reply',
                            message_id: genGroupMessageId(data.group_id, data.source.user_id, data.source.seq, data.source.rand, data.source.time)
                        })
                        break;
                    case 'private':
                        data.message.shift({
                            type: 'reply',
                            message_id: genDmMessageId(data.source.user_id, data.source.seq, data.source.rand, data.source.time)
                        })
                        break;
                }
            }
            instance.dispatch(result)
        }
    }
}

export enum OneBotStatus {
    Good,
    Bad
}

export type OneBotConfig = OneBot.Config<OneBot.Version>
export namespace OneBot {
    export type Version = 'V11' | 'V12'
    export type Config<V extends Version = 'V11'> = ({
        version?: V
        password?: string
    } & (V extends 'V11' ? V11.Config : V12.Config))

    export interface Base {
        start(path?: string): any

        stop(): any

        dispatch(...args: any[]): any

        apply(...args: any[]): any
    }
}
export const BOOLS = ["no_cache", "auto_escape", "as_long", "enable", "reject_add_request", "is_dismiss", "approve", "block"]
