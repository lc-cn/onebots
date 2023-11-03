import type {QQAdapter} from "@/adapters/qq";
import axios,{AxiosInstance} from "axios";
import {WebSocket} from "ws";
import {EventEmitter} from "events";
import {util} from "icqq/lib/core/protobuf/protobuf.min";
import {SessionManager} from "@/adapters/qq/sessionManager";
import {OneBot} from "@/onebot";
import {Dict} from "@zhinjs/shared";

export class QQBot extends EventEmitter{
    request:AxiosInstance
    self_id:string
    nickname:string
    status:number
    ws:WebSocket
    sessionManager:SessionManager
    constructor(public oneBot:OneBot, public appId:string, public config:QQAdapter.Config['protocol']) {
        super()
        this.sessionManager=new SessionManager(this)
        this.request=axios.create({
            baseURL: this.config.sandbox?'https://sandbox.api.sgroup.qq.com':`https://api.sgroup.qq.com`,
            timeout: 5000,
            headers: {
                'User-Agent': `BotNodeSDK/0.0.1`
            }
        })
        this.request.interceptors.request.use((config)=>{
            if(QQBot.GUilD_APIS.some(c=>{
                if(typeof c==='string') return c===config.url
                return c.test(config.url)
            })){
                config.headers['Authorization']=`Bot ${this.appId}.${this.sessionManager.token}`
            }else{
                config.headers['Authorization']=`QQBot ${this.sessionManager.access_token}`
                config.headers['X-Union-Appid']=this.appId
            }
            if(config['rest']){
                const restObj=config['rest']
                delete config['rest']
                for(const key in restObj){
                    config.url=config.url.replace(':'+key,restObj[key])
                }
            }
            return config
        })
    }
    static parseMessageElements(message:OneBot.MessageElement<OneBot.Version>[],source?:Dict){
        const getType = (type: string) => {
            return ['image','file', 'audio'].indexOf(type) + 1
        }
        const messages:Dict={
            msg_type:0,
            timestamp:Number((Date.now()/1000).toFixed(0))
        }
        const files:Dict={
            timestamp:Number((Date.now()/1000).toFixed(0))
        }
        let hasMessages=false,hasFiles=false,buttons=[];
        for (let elem of message) {
            if (typeof elem === 'string') {
                elem = {type: 'text', data: {text: elem}}
            }
            switch (elem.type) {
                case 'reply':
                    messages.msg_id=elem.data.id
                    files.msg_id=elem.data.id
                    break;
                case "mention":
                    if(messages.content){
                        messages.content+=`<@${elem.data.id||'everyone'}>`
                    }else{
                        messages.content=`<@${elem.data.id||'everyone'}>`
                    }
                case 'link':
                    if(messages.content){
                        messages.content+=`<#${elem.data.channel_id}>`
                    }else{
                        messages.content=`<#${elem.data.channel_id}>`
                    }
                case 'text':
                    if(messages.content){
                        messages.content+=elem.data.text
                    }else{
                        messages.content=elem.data.text
                    }
                    hasMessages=true
                    break;
                case 'face':
                    if(messages.content){
                        messages.content+=`<emoji:${elem.data.id}>`
                    }else{
                        messages.content=`<emoji:${elem.data.id}>`
                    }
                    hasMessages=true
                    break;
                case 'image':
                case 'video':
                case 'audio':
                case'file':
                    files.file_type = getType(elem.type)
                    files.content='file'
                    files.url = elem.data.src;
                    files.event_id=source!.event_id
                    files.msg_id=source?.message_id
                    files.srv_send_msg = true
                    hasFiles=true
                    break;
                case 'markdown':
                    messages.markdown = {
                        content: elem.data.content
                    }
                    messages.msg_type = 2
                    hasMessages=true
                    break;
                case 'button':
                    buttons.push(elem.data)
            }
        }
        if(buttons.length) {
            const rows=[]
            for(let i=0;i<buttons.length;i+=4){
                rows.push(buttons.slice(i,i+4))
            }
            messages.keyboard={
                content:{
                    rows:rows.map(row=>{
                        return {
                            buttons:row
                        }
                    })
                }
            }
        }
        return {
            messages:messages,
            hasFiles,
            hasMessages,
            files
        }
    }
    processPayload(event_id:string,event:string,payload:Dict){
        let [post_type,...sub_type]=event.split('.')
        const result:Dict={
            event_id,
            self_id:this.self_id,
            post_type,
            [`${post_type}_type`]:sub_type.join('.'),
            ...payload
        }
        if(['message.group','message.private','message.guild'].includes(event)){
            result.message=QQBot.processMessage(payload)
            Object.assign(result,{
                user_id:payload.author?.id,
                sender:{
                    user_id:payload.author?.id,
                    user_openid:payload.author?.user_openid||payload.author?.member_openid
                },
                timestamp:new Date(payload.timestamp).getTime()/1000,
            })
            delete result.content
        }
        return result
    }
    async sendPrivateMessage(user_id:string,message:OneBot.MessageElement<OneBot.Version>[]){
        const {hasMessages,messages,hasFiles,files}=QQBot.parseMessageElements(message)
        let message_id=''
        if(hasMessages){
            let {data:{id}}=await this.request.post(`/v2/users/${user_id}/messages`,messages)
            message_id=id
        }
        if(hasFiles){
            let {data:{id}}=await this.request.post(`/v2/users/${user_id}/files`,files)
            if(message_id) message_id=`${message_id}|`
            message_id=message_id+id
        }
        return {
            message_id,
            timestamp:new Date().getTime()/1000
        }
    }
    async sendGroupMessage(group_id:string,message:OneBot.MessageElement<OneBot.Version>[]){
        const {hasMessages,messages,hasFiles,files}=QQBot.parseMessageElements(message)
        let message_id:string=''
        if(hasMessages){
            let {data:{id}}=await this.request.post(`/v2/groups/${group_id}/messages`,messages)
            message_id=id
        }
        if(hasFiles){
            let {data:{id}}=await this.request.post(`/v2/groups/${group_id}/files`,files)
            if(message_id) message_id=`${message_id}|`
            message_id=message_id+id
        }
        return {
            message_id,
            timestamp:new Date().getTime()/1000
        }
    }
    async sendGuildMessage(guild_id:string,channel_id:string,message:OneBot.MessageElement<OneBot.Version>[]){
        const {hasMessages,messages,hasFiles,files}=QQBot.parseMessageElements(message)
        let message_id=''
        if(hasMessages){
            let {data:{id}}=await this.request.post(`/channels/${channel_id}/messages`,messages)
            message_id=id
        }
        if(hasFiles){
            let {data:{id}}=await this.request.post(`/channels/${channel_id}/files`,files)
            if(message_id) message_id=`${message_id}|`
            message_id=message_id+id
        }
        return {
            message_id,
            timestamp:new Date().getTime()/1000
        }
    }
    async getGuildInfo(guild_id:string){
        const result=await this.request.get(`/guilds/${guild_id}`)
        const {id:_,name:guild_name,joined_at,...guild}=result.data||{}
        return {
            guild_id,
            guild_name,
            join_time:new Date(joined_at).getTime()/1000,
            ...guild
        }
    }
    async getGuildRoles(guild_id:string){
        const result=await this.request.get(`/guilds/${guild_id}/roles`)
        return (result.data?.roles||[]).map(role=>{
            return {
                guild_id,
                ...role
            }
        })
    }
    async getGuildList(){
        const _getGuildList=async(after:string=undefined)=>{
            const res=await this.request.get('/users/@me/guilds',{
                params:{
                    after
                }
            })
            if(!res.data?.length) return []
            const result= (res.data||[]).map(g=>{
                const {id:guild_id,name:guild_name,joined_at,...guild}=g
                return {
                    guild_id,
                    guild_name,
                    join_time:new Date(joined_at).getTime()/1000,
                    ...guild
                }
            })
            const last=result[result.length-1]
            return [...result,...await _getGuildList(last.guild_id)]
        }
        return _getGuildList()
    }
    async getGuildMemberList(guild_id:string){
        const _getGuildMemberList=async (after:string=undefined)=>{
            const res=await this.request.get(`/guilds/${guild_id}/members`,{
                params:{
                    after,
                    limit:100
                }
            })
            if(!res.data?.length) return []
            const result= (res.data||[]).map(m=>{
                const {id:member_id,role,join_time,...member}=m
                return {
                    member_id,
                    role,
                    join_time:new Date(join_time).getTime()/1000,
                    ...member
                }
            })
            const last=result[result.length-1]
            return [...result,...await _getGuildMemberList(last.member_id)]
        }
        return _getGuildMemberList()
    }
    async getGuildMemberInfo(guild_id:string,member_id:string){
        const result=await this.request.get(`/guilds/${guild_id}/members/${member_id}`)
        const {user:{id:_,...member},nick:nickname,joined_at,roles}=result.data||{}
        return {
            guild_id,
            user_id:member_id,
            roles,
            join_time:new Date(joined_at).getTime()/1000,
            nickname,
            ...member
        }
    }
    async getChannelList(guild_id:string){
        const result=await this.request.get(`/guilds/${guild_id}/channels`)
        return (result.data||[]).map(c=>{
            const {id:channel_id,name:channel_name,...channel}=c
            return {
                channel_id,
                channel_name,
                ...channel
            }
        })
    }
    async getChannelInfo(channel_id:string){
        const result=await this.request.get(`/channels/${channel_id}`)
        const {id:_,name:channel_name,...channel}=result.data||{}
        return {
            channel_id,
            channel_name,
            ...channel
        }
    }
    dispatchEvent(event: string, wsRes: any) {
        this.oneBot.logger.debug(event,wsRes)
        const payload = wsRes.d;
        const event_id = wsRes.id || '';
        if (!payload || !event) return;
        this.em(QQEvent[event], this.processPayload(event_id,QQEvent[event],payload));
    }
    em(event:string,payload:Dict){
        const eventNames=event.split('.')
        let prefix=''
        while (eventNames.length){
            let fullEventName=`${prefix}.${eventNames.shift()}`
            if(fullEventName.startsWith('.')) fullEventName=fullEventName.slice(1)
            this.emit(fullEventName,payload)
            prefix=fullEventName
        }
    }
    async init(){
        await this.sessionManager.init()
    }
    stop(){

    }
}
export enum QQEvent {
    MESSAGE_CREATE='message.guild',
    GROUP_ADD_ROBOT='notice.group.increase',
    GROUP_DEL_ROBOT='notice.group.decrease',
    FRIEND_ADD='notice.friend.add',
    FRIEND_DEL='notice.friend.del',
    C2C_MESSAGE_CREATE='message.private',
    GROUP_AT_MESSAGE_CREATE='message.group',
}
// 心跳参数
export enum OpCode {
    DISPATCH = 0, // 服务端进行消息推送
    HEARTBEAT = 1, // 客户端发送心跳
    IDENTIFY = 2, // 鉴权
    RESUME = 6, // 恢复连接
    RECONNECT = 7, // 服务端通知客户端重连
    INVALID_SESSION = 9, // 当identify或resume的时候，如果参数有错，服务端会返回该消息
    HELLO = 10, // 当客户端与网关建立ws连接之后，网关下发的第一条消息
    HEARTBEAT_ACK = 11, // 当发送心跳成功之后，就会收到该消息
}
export namespace QQBot{
    import resolve = util.path.resolve;

    export interface Token{
        access_token:string
        expires_in:number
        cache:string
    }
    export function processMessage(payload:Dict){
        let template=payload.content||''
        let result:OneBot.MessageElement<OneBot.Version>[]=[]
        // 1. 处理文字表情混排
        const regex = /("[^"]*?"|'[^']*?'|`[^`]*?`|“[^”]*?”|‘[^’]*?’|<[^>]+?>)/;
        while (template.length){
            const [match] = template.match(regex) || [];
            if (!match) break;
            const index = template.indexOf(match);
            const prevText = template.slice(0, index);
            if (prevText) {
                result.push({
                    type:'text',
                    data:{
                        text:prevText
                    }
                })
            }
            template = template.slice(index + match.length);
            if(match.startsWith('<')){
                let [type,...attrs]=match.slice(1,-1).split(',');
                if(type.startsWith('faceType')) {
                    type='face'
                    attrs=attrs.map((attr:string)=>attr.replace('faceId','id'))
                }else if(type.startsWith('@')){
                    if(type.startsWith('@!')){
                        const id=type.slice(2,)
                        type='mention'
                        attrs=Object.entries(payload.mentions.find((u:Dict)=>u.id===id)||{})
                            .map(([key,value])=>`${key}=${value}`)
                    }else if(type==='@everyone'){
                        type='mention'
                        attrs=[['all',true]]
                    }
                }else if(/^[a-z]+:[0-9]+$/.test(type)){
                    attrs=[['id',type.split(':')[1]]]
                    type='face'
                }
                result.push({
                    type,
                    data:Object.fromEntries(attrs.map((attr:string)=>{
                        const [key,...values]=attr.split('=')
                        return [key.toLowerCase(),values.join('=').slice(1,-1)]
                    }))
                })
            }
        }
        if(template){
            result.push({
                type:'text',
                data:{
                    text:template
                }
            })
        }
        // 2. 将附件添加到消息中
        if(payload.attachments){
            for(const attachment of payload.attachments){
                let {content_type,...data}=attachment
                const [type]=content_type.split('/')
                result.push({
                    type,
                    data:{
                        ...data,
                        src:data.src||data.url,
                        url:data.url||data.src
                    }
                })
            }
        }
        delete payload.attachments
        delete payload.mentions
        return result
    }
    export const GUilD_APIS:(string|RegExp)[]=[
        "/users/@me/guilds",
        /^\/guilds\/([a-zA-Z0-9]+)\/members\/([a-zA-Z0-9]+)$/,
        /^\/guilds\/([a-zA-Z0-9]+)\/members$/,
        /^\/guilds\/([a-zA-Z0-9]+)$/,
        /^\/guilds\/([a-zA-Z0-9]+)\/channels$/,
        /^\/guilds\/([a-zA-Z0-9]+)\/roles$/,
        /^\/channels\/([a-zA-Z0-9]+)$/,
        /^\/channels\/([a-zA-Z0-9]+)\/messages$/,
    ]
}
