import {Adapter} from "@/adapter";
import {App} from "@/server/app";
import {Config as IcqqConfig} from "icqq/lib/client";
import { Client, MessageElem } from "icqq";
import process from "process";
import {rmSync} from "fs";
import {Dict} from "@zhinjs/shared";
import {OneBot} from "@/onebot";
const processMessages=(list:OneBot.MessageElement<OneBot.Version>[])=>{
    return list.map(item=>{
        const {type,data}=item
        if(type==='node') return {
            type,
            ...data,
            message:processMessages(data.message||[])
        }
        return {
            type,
            ...data
        }
    })
}
export default class IcqqAdapter extends Adapter<'icqq'>{
    #password?:string
    #disposes:Map<string,Function>=new Map<string, Function>()
    constructor(app: App, config: IcqqAdapter.Config) {
        super(app,'icqq', config);
    }
    createOneBot(uin: string, protocol: Dict, versions: OneBot.Config[]): OneBot {
        const oneBot= super.createOneBot(uin, protocol, versions);
        this.#password=this.app.config[`icqq.${uin}`].password;
        oneBot.internal=new Client(protocol)
        return oneBot
    }
    formatEventPayload<V extends OneBot.Version>(version: V, event: string, data: any):OneBot.Payload<V> {
        return {
            id: data.id,
            type: event,
            version: version,
            self:{
                platform:'icqq',
                user_id: data.self_id
            },
            detail_type: data.message_type||data.notice_type||data.request_type,
            platform: 'icqq',
            ...data,
            message:this.toMessageElement(data)
        }
    }
    toMessageElement<V extends OneBot.Version>(event: any):OneBot.MessageElement<V>[] {
        if(!event||!event.message) return null
        const messageArr:(MessageElem|string)[]=[].concat(event.message)
        const result:OneBot.MessageElement<V>[]=[]
        if(event.source){
            result.push({
                type:'quote',
                data:{
                    id:`${event.source.rand}${event.source.seq}_${event.source.time}`,
                }
            })
        }
        for(const message of messageArr){
            if(typeof message==='string'){
                result.push({
                    type:'text',
                    data:{
                        text:message
                    }
                })
            }else{
                const {type,...data}=message
                result.push({
                    type,
                    data
                })
            }
        }
        return result
    }
    sendPrivateMessage<V extends OneBot.Version>(uin: string, version: V, args: [string, OneBot.MessageElement<V>[]]): Promise<OneBot.MessageRet<V>> {
        const [user_id,message]=args

        return this.oneBots.get(uin)?.internal.sendPrivateMsg(user_id,processMessages(message))
    }
    sendGroupMessage<V extends OneBot.Version>(uin: string, version: V, args: [string, OneBot.MessageElement<V>[]]): Promise<OneBot.MessageRet<V>> {
        const [group_id,message]=args
        return this.oneBots.get(uin)?.internal.sendGroupMsg(group_id,processMessages(message))
    }

    call<V extends OneBot.Version>(uin: string, version: V, method: string, args: any[]=[]): Promise<any> {
        try{
            if(this[method]) return this[method](uin,version,args)
            return this.oneBots.get(uin)?.internal[method](...args)
        }catch {
            throw OneBot.UnsupportedMethodError
        }
    }

    fromSegment<V extends OneBot.Version>(version: V, segment: OneBot.Segment<V>|OneBot.Segment<V>[]): OneBot.MessageElement<V>[] {
        return [].concat(segment).map(item=>{
            if(typeof item==="string") return {
                type:'text',
                data:{
                    text:item
                }
            }
            return {
                type:item.type,
                data:item.data
            }
        })
    }
    toSegment<V extends OneBot.Version,M=any>(version: V, message: M): OneBot.Segment<V>[] {
        return [].concat(message).map(item=>{
            if(typeof item!=='object') item={
                type:'text',
                data:{
                    text:item
                }
            }
            const {type,...data}=item
            return {
                type,
                data
            }
        })
    }

    fromCqcode<V extends OneBot.Version>(version: V, message: string): OneBot.MessageElement<V>[] {
        const regExpMatchArray=message.match(/\[CQ:([a-z]+),(!])+]/g)
        if(!regExpMatchArray) return [
            {
                type:'text',
                data:{
                    text:message
                }
            }
        ]
        const result:OneBot.MessageElement<V>[]=[]
        for(const match of regExpMatchArray){
            const [type,...valueArr]=match.substring(1,match.length-1).split(',')
            result.push({
                type:type,
                data:Object.fromEntries(valueArr.map(item=>{
                    const [key,value]=item.split('=')
                    return [key,value]
                }))
            })
        }
        return result
    }

    toCqcode<V extends OneBot.Version>(version: V, messageArr:OneBot.MessageElement<V>[]): string {
        return [].concat(messageArr).map(item=>{
            const dataStr=Object.entries(item.data).map(([key,value])=>{
                // is Buffer
                if(value instanceof Buffer) return `${key}=${value.toString('base64')}`
                // is Object
                if(value instanceof Object) return `${key}=${JSON.stringify(value)}`
                // is Array
                if(value instanceof Array) return `${key}=${value.map(v=>JSON.stringify(v)).join(',')}`
                // is String
                return `${key}=${item.data[key]}`
            })
            return `[CQ:${item.type},${dataStr.join(',')}]`
        }).join('')
    }

    getSelfInfo<V extends OneBot.Version>(uin: string, version: V): OneBot.SelfInfo<V> {
        const client:Client=this.oneBots.get(uin).internal
        return {
            nickname: client.nickname,
            status: this.oneBots.get(uin).status,
        } as OneBot.SelfInfo<V>;
    }

    async startOneBot(oneBot:OneBot){
        const _this=this;
        const disposeArr=[]
        const client:Client=oneBot.internal
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
        client.trap('system.login.slider', function sliderHelper(e) {
            _this.logger.mark('请输入滑块验证返回的ticket')
            process.stdin.once('data', (e) => {
                this.submitSlider(e.toString().trim())
            })
            disposeArr.push(() => {
                this.off('system.login.slider', sliderHelper)
            })
        })
        disposeArr.push(client.on('message',(event)=>{
            this.emit('message.receive',oneBot.uin,event)
        }))
        disposeArr.push(client.on('notice',(event)=>{
            this.emit('notice.receive',oneBot.uin,event)
        }))
        disposeArr.push(client.on('request',(event)=>{
            this.emit('request.receive',oneBot.uin,event)
        }))
        await client.login(parseInt(oneBot.uin),this.#password)
        return new Promise<Function>((resolve,reject)=>{
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
            const clean = () => {
                clearTimeout(timer)
                while (disposeArr.length) {
                    disposeArr.shift()()
                }
            }
            client.trap('system.online', ()=>{
                clearTimeout(timer)
                resolve(clean)
            })
            const timer=setTimeout(()=>{
                clean()
                reject('登录超时')
            },this.app.config.timeout*1000)
        })
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
