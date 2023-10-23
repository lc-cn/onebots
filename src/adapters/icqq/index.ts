import {Adapter} from "@/adapter";
import {App} from "@/server/app";
import {Config as IcqqConfig} from "icqq/lib/client";
import {Client} from "icqq";
import process from "process";
import {rmSync} from "fs";
import {Dict} from "@zhinjs/shared";
import {OneBot} from "@/onebot";

export default class IcqqAdapter extends Adapter<'icqq'> implements Adapter.Base{
    #password?:string
    #disposes:Map<string,Function>=new Map<string, Function>()
    constructor(app: App, config: IcqqAdapter.Config) {
        super(app,'icqq', config);
    }
    createOneBot(uin: string, protocol: Dict, versions: OneBot.Config[]): OneBot {
        const oneBot= super.createOneBot(uin, protocol, versions);
        this.#password=this.app.config[uin].password;
        oneBot.internal=new Client(protocol)
        return oneBot
    }
    async startOneBot(oneBot:OneBot){
        const _this=this;
        const disposeArr=[]
        const client:Client=oneBot.internal
        const clean = () => {
            clearTimeout(timer)
            while (disposeArr.length) {
                disposeArr.shift()()
            }
        }
        client.trap('system.login.qrcode', function qrcodeHelper() {
            _this.logger.log('扫码后回车继续')
            process.stdin.once('data', () => {
                this.login()
            })
            disposeArr.push(() => {
                this.off('system.login.qrcode', qrcodeHelper)
            })
        })
        client.trap('system.login.device', function deviceHelper(e) {
            _this.logger.mark('请选择验证方式：1.短信验证  2.url验证')
            process.stdin.once('data', (buf) => {
                const input=buf.toString().trim()
                if(input==='1') {
                    this.sendSmsCode()
                    _this.logger.mark('请输入短信验证码:')
                    process.stdin.once('data',buf=>{
                        this.submitSmsCode(buf.toString().trim())
                    })
                }else{
                    _this.logger.mark(`请前往：${e.url} 完成验证后回车继续`)
                    process.stdin.once('data',()=>{
                        this.login()
                    })
                }
            })
            disposeArr.push(() => {
                this.off('system.login.device', deviceHelper)
            })
        })
        client.trap('system.login.error', function errorHandler(e) {
            if (e.message.includes('密码错误')) {
                process.stdin.once('data', (e) => {
                    this.login(e.toString().trim())
                })
            } else {
                _this.logger.error(e.message)
                clean()
            }
            this.off('system.login.error', errorHandler)
        })
        client.trap('system.login.slider', function sliderHelper(e) {
            _this.logger.mark('请输入滑块验证返回的ticket')
            process.stdin.once('data', (e) => {
                this.submitSlider(e.toString().trim())
            })
            disposeArr.push(() => {
                this.off('system.login.slider', sliderHelper)
            })
        })
        client.trap('system.online', clean)
        const timer=setTimeout(()=>{
            clean()
        },this.app.config.timeout*1000)
        await client.login(parseInt(oneBot.uin),this.#password)
        return clean
    }
    async start(uin?:string){
        const startOneBots=[...this.oneBots.values()].filter(oneBot=>{
            return uin?oneBot.uin===uin:true
        })
        for(const oneBot of startOneBots){
            this.#disposes.set(oneBot.uin,await this.startOneBot(oneBot))
        }
        await super.start()
    }
    async stop(uin?:string,force?:boolean){
        const stopOneBots=[...this.oneBots.values()].filter(oneBot=>{
            return uin?oneBot.uin===uin:true
        })
        for(const oneBot of stopOneBots){
            const dispose=this.#disposes.get(oneBot.uin)
            if(dispose){
                dispose()
            }
            if(force){
                rmSync(oneBot.internal.dir, {force: true, recursive: true})
            }
        }
        await super.stop()
    }
}
declare module '@/adapter'{
    export namespace Adapter{
        export interface Configs{
            icqq: IcqqAdapter.Config
        }
    }
}
export namespace IcqqAdapter {
    export interface Config extends Adapter.Config<'icqq'> {
        protocol?:IcqqConfig
        password?:string
    }
}
