import axios from "axios";
import {QQBot} from "@/adapters/qq/bot";
import {util} from "icqq/lib/core/protobuf/protobuf.min";
import resolve = util.path.resolve;

export class SessionManager{
    public token:string
    public wsUrl:string
    constructor(private bot:QQBot) {
    }
    async getAccessToken():Promise<QQBot.Token>{
        const {appId}=this.bot
        let {secret}=this.bot.config
        const getToken=()=>{
            return new Promise<QQBot.Token>((resolve,reject)=>{
                axios.post('https://bots.qq.com/app/getAppAccessToken',{
                    appId,
                    clientSecret:secret
                }).then(res=>{
                    if(res.status===200 && res.data && typeof res.data==='object'){
                        resolve(res.data as QQBot.Token)
                    }else{
                        reject(res)
                    }
                })
            })
        }
        const getNext=async (next_time:number)=>{
            return new Promise<QQBot.Token>(resolve=>{
                setTimeout(async ()=>{
                    const token=await getToken()
                    this.token=token.access_token
                    getNext(token.expires_in)
                    resolve(token)
                },next_time*1000)
            })
        }
        return getNext(0)
    }
    async getWsUrl(){
        return new Promise<void>((resolve)=>{
            this.bot.request.get('/gateway/bot',{
                headers: {
                    Accept: '*/*',
                    'Accept-Encoding': 'utf-8',
                    'Accept-Language': 'zh-CN,zh;q=0.8',
                    Connection: 'keep-alive',
                    'User-Agent': 'v1',
                    Authorization: '',
                }
            }).then(res=>{
                if (!res.data) throw new Error('获取ws连接信息异常');
                this.wsUrl=res.data.url
                resolve()
            })
        })
    }
    getValidIntends(){
        return (this.bot.config.intents||[]).reduce((result,item)=>{
           return result | Intends[item as keyof Intends]
        },0)
    }
    async init(){
        await this.getAccessToken()
        await this.getWsUrl()
    }
}
export enum Intends{
    GROUP_MESSAGE_CREATE= 1 << 24,
    GROUP_AT_MESSAGE_CREATE= 1 << 25,
}
