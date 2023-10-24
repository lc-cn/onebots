import {EventEmitter} from "events";
import {App} from "@/server/app";
import {OneBot} from "@/onebot";
import {Dict} from "@zhinjs/shared";
import {Logger} from "log4js";

export abstract class Adapter<T extends string=string> extends EventEmitter{
    oneBots:Map<string,OneBot>=new Map<string,OneBot>();
    #logger:Logger
    protected constructor(public app:App,public platform:T, public config:Adapter.Configs[T]) {
        super();
    }
    get logger(){
        return this.#logger||=this.app.getLogger(this.platform)
    }
    getLogger(uin:string,version:string){
        return this.app.getLogger(`${this.platform}-${version}(${uin})`)
    }
    createOneBot(uin:string,protocol:Dict,versions:OneBot.Config[]):OneBot{
        const oneBot= new OneBot(this,uin,versions)
        this.oneBots.set(uin,oneBot)
        return oneBot
    }
    async start(uin?:string):Promise<any>{
        const startOneBots=[...this.oneBots.values()].filter(oneBot=>{
            return uin?oneBot.uin===uin:true
        })
        for(const oneBot of startOneBots){
            await oneBot.start()
        }
        this.app.emit('adapter.start',this.platform)
    }
    async stop(uin?:string,force?:boolean):Promise<any>{
        const stopOneBots=[...this.oneBots.values()].filter(oneBot=>{
            return uin?oneBot.uin===uin:true
        })
        for(const oneBot of stopOneBots){
            await oneBot.stop(force)
        }
        this.app.emit('adapter.stop',this.platform)
    }
}
type GroupInfo={
    group_id:string|number
    group_name:string
}
type UserInfo={
    user_id:string|number
    user_name:string
}
export interface Adapter extends Adapter.Base{
    call<V extends OneBot.Version>(uin:string,version:V,method:string,args?:any[]):Promise<any>
}
export namespace Adapter {
    export interface Base{
        toSegment<V extends OneBot.Version>(version:V,message:OneBot.MessageElement<V>[]):OneBot.Segment<V>[]
        fromSegment<V extends OneBot.Version>(version:V,segment:OneBot.Segment<V>):OneBot.MessageElement<V>[]
        toCqcode<V extends OneBot.Version>(version:V,message:OneBot.MessageElement<V>[]):string
        fromCqcode<V extends OneBot.Version>(version:V,message:string):OneBot.MessageElement<V>[]
        getSelfInfo<V extends OneBot.Version>(uin:string,version:V):OneBot.SelfInfo<V>
        /** 格式化事件 */
        formatEventPayload<V extends OneBot.Version>(version:V,event:string,payload:Dict):OneBot.Payload<V>
        /** 解析消息事件的消息 */
        parseMessage<V extends OneBot.Version>(version:V,payload:Dict):OneBot.Message<V>[]
        /** 获取群列表 */
        getGroupList<V extends OneBot.Version>(uin:string,version:V):Promise<OneBot.GroupInfo<V>[]>
        /** 获取好友列表 */
        getFriendList<V extends OneBot.Version>(uin:string,version:V):Promise<OneBot.UserInfo<V>[]>
        getGroupMemberList<V extends OneBot.Version>(uin:string,version:V,args:[string]):Promise<OneBot.GroupMemberInfo<V>[]>
        /** 发送群消息 */
        sendGroupMessage<V extends OneBot.Version>(uin:string,version:V,args:[string,OneBot.MessageElement<V>[]]):Promise<OneBot.MessageRet<V>>
        /** 发送私聊消息 */
        sendPrivateMessage<V extends OneBot.Version>(uin:string,version:V,args:[string,OneBot.MessageElement<V>[]]):Promise<OneBot.MessageRet<V>>
        /** 获取消息 */
        getMessage<V extends OneBot.Version>(uin:string,version:V):Promise<OneBot.Message<V>>
        deleteMessage<V extends OneBot.Version>(uin:string,version:V,args:[string]):Promise<boolean>
    }
    export interface Configs{
        [key:string]:Adapter.Config
    }
    export type Config<T extends string=string>={
        platform: T
        versions:OneBot.Config<OneBot.Version>[]
        protocol?:Dict
    } & Record<string,any>
}
