import axios, {AxiosInstance} from "axios";
import {WebSocket} from "ws";
import * as log4js from 'log4js'
import {EventEmitter} from "events";
import {SessionManager} from "./sessionManager";
import {Quotable, Sendable} from "./elements";
import { ApiBaseInfo, Dict, LogLevel, UpdatePermissionParams } from "./types";
import {DirectMessageEvent, GroupMessageEvent, GuildMessageEvent, Message, PrivateMessageEvent} from "./message";
import {EventMap, QQEvent} from "./event";
import { Bot } from "./bot";
import { Channel } from "@/adapters/qq/entries/channel";
import { Guild } from "@/adapters/qq/entries/guild";
import { OneBot } from "@/onebot";
import UnsupportedMethodError = OneBot.UnsupportedMethodError;

export class QQBot extends EventEmitter {
    request: AxiosInstance
    self_id: string
    nickname: string
    status: number
    logger: log4js.Logger
    ws: WebSocket
    sessionManager: SessionManager
    constructor(public config: QQBot.Config) {
        super()
        this.sessionManager = new SessionManager(this)
        this.request = axios.create({
            baseURL: this.config.sandbox ? 'https://sandbox.api.sgroup.qq.com' : `https://api.sgroup.qq.com`,
            timeout: 5000,
            headers: {
                'User-Agent': `BotNodeSDK/0.0.1`
            }
        })
        this.request.interceptors.request.use((config) => {
            config.headers['Authorization'] = `QQBot ${this.sessionManager.access_token}`
            config.headers['X-Union-Appid'] = this.config.appid
            if (config['rest']) {
                const restObj = config['rest']
                delete config['rest']
                for (const key in restObj) {
                    config.url = config.url.replace(':' + key, restObj[key])
                }
            }
            return config
        })
        this.logger = log4js.getLogger(`[QQBot:${this.config.appid}]`)
        this.logger.level = this.config.logLevel ||= 'info'
    }

    removeAt(payload: Dict) {
        const reg = new RegExp(`<@!${this.self_id}>`)
        const isAtMe = reg.test(payload.content) && payload.mentions.some(mention => mention.id === this.self_id)
        if (!isAtMe) return
        payload.content = payload.content.replace(reg, '').trimStart()
    }
    processPayload(event_id: string, event: string, payload: Dict) {
        let [post_type, ...sub_type] = event.split('.')
        const result: Dict = {
            event_id,
            post_type,
            [`${post_type}_type`]: sub_type.join('.'),
            ...payload
        }
        if (['message.group', 'message.private', 'message.guild','message.direct'].includes(event)) {
            this.removeAt(payload)
            const [message, brief] = Message.parse.call(this, payload)
            result.message = message as Sendable
            Object.assign(result, {
                user_id: payload.author?.id,
                message_id: payload.event_id || payload.id,
                raw_message: brief,
                sender: {
                    user_id: payload.author?.id,
                    nickname: payload.author?.name||'',
                    user_openid: payload.author?.user_openid || payload.author?.member_openid,
                    ...(payload.author || {})
                },
                timestamp: new Date(payload.timestamp).getTime() / 1000,
            })
            let messageEvent: PrivateMessageEvent | GroupMessageEvent | GuildMessageEvent|DirectMessageEvent
            switch (event) {
                case 'message.private':
                    messageEvent = new PrivateMessageEvent(this as unknown as Bot, result)
                    this.logger.info(`recv from User(${result.user_id}): ${result.raw_message}`)
                    break;
                case 'message.group':
                    messageEvent = new GroupMessageEvent(this as unknown as Bot, result)
                    this.logger.info(`recv from Group(${result.group_id}): ${result.raw_message}`)
                    break;
                case 'message.guild':
                    messageEvent = new GuildMessageEvent(this as unknown as Bot, result)
                    this.logger.info(`recv from Guild(${result.guild_id})Channel(${result.channel_id}): ${result.raw_message}`)
                    break;
                case 'message.direct':
                    messageEvent=new DirectMessageEvent(this as unknown as Bot,result)
                    this.logger.info(`recv from Direct(${result.guild_id}): ${result.raw_message}`)
                    break;
            }
            return messageEvent
        }
        return result
    }

    async getSelfInfo() {
        const { data: result } = await this.request.get('/users/@me')
        return result
    }
    async getChannelPermissionOfRole(channel_id:string,role_id:string){
        const {data:result} = await this.request.get(`/channels/${channel_id}/roles/${role_id}/permissions`)
        return result
    }
    async setChannelAnnounce(guild_id:string,channel_id:string,message_id:string){
        const {data:result}=await this.request.post(`/guilds/${guild_id}/announces`,{
            message_id,
            channel_id
        })
        return result
    }
    async updateChannelPermissionOfRole(channel_id:string,role_id:string,permission:UpdatePermissionParams){
        const result = await this.request.put(`/channels/${channel_id}/roles/${role_id}/permissions`,permission)
        return result.status===204
    }
    async getChannelMemberPermission(channel_id:string,member_id:string){
        const {data:result} = await this.request.get(`/channels/${channel_id}/members/${member_id}/permissions`)
        return result
    }
    async updateChannelMemberPermission(channel_id:string,member_id:string,permission:UpdatePermissionParams){
        const result = await this.request.put(`/channels/${channel_id}/members/${member_id}/permissions`,permission)
        return result.status===204
    }
    async getChannelPins(channel_id:string):Promise<string[]>{
        const {data:{message_ids=[]}={}} = await this.request.get(`/channels/${channel_id}/pins`)
        return message_ids
    }
    async pinChannelMessage(channel_id:string,message_id:string){
        const {data:result}= await this.request.post(`/channels/${channel_id}/pins/${message_id}`)
        return result
    }
    async unPinChannelMessage(channel_id:string,message_id:string){
        const {data:result}= await this.request.delete(`/channels/${channel_id}/pins/${message_id}`)
        return result
    }
    async createChannel(guild_id: string, channelInfo: Omit<Channel.Info, 'id'>): Promise<Channel.Info> {
        const { data: result } = await this.request.post(`/guilds/${guild_id}/channels`, channelInfo)
        return result
    }
    async updateChannel({ channel_id, ...updateInfo }: { channel_id: string } & Partial<Pick<Channel.Info, 'name' | 'position' | 'parent_id' | 'private_type' | 'speak_permission'>>): Promise<Channel.Info> {
        const { data: result } = await this.request.patch(`/channels/${channel_id}`, updateInfo)
        return result
    }
    async deleteChannel(channel_id: string) {
        const result = await this.request.delete(`/channels/${channel_id}`)
        return result.status === 200
    }
    async getGuildRoles(guild_id:string){
        const {data:{roles=[]}={}} = await this.request.get(`/guilds/${guild_id}/roles`)
        return roles
    }
    async creatGuildRole(guild_id:string,role:Pick<Guild.Role,'name'|'color'|'hoist'>):Promise<Guild.Role>{
        const {data:result}=await this.request.post(`/guilds/${guild_id}/roles`,role)
        return result.role
    }
    async updateGuildRole(guild_id:string,{id,...role}:Pick<Guild.Role,'id'|'name'|'color'|'hoist'>){
        const {data:result}=await this.request.patch(`/guilds/${guild_id}/roles/${id}`,role)
        return result.role
    }
    async deleteGuildRole(role_id:string){
        const result = await this.request.delete(`/guilds/{guild_id}/roles/${role_id}`)
        return result.status===204
    }
    async getGuildAccessApis(guild_id:string){
        const {data:result} = await this.request.get(`/guilds/${guild_id}/api_permission`)
        return result.apis||[]
    }
    async applyGuildAccess(guild_id:string,channel_id:string,apiInfo:ApiBaseInfo,desc?:string){
        const {data:result} = await this.request.post(`/guilds/${guild_id}/api_permission/demand`,{
            channel_id,
            api_identify:apiInfo,
            desc,
        })
        return result
    }
    async unMuteGuild(guild_id:string){
        return this.muteGuild(guild_id,0,0)
    }
    async muteGuild(guild_id:string,seconds:number,end_time?:number){
        const result=await this.request.put(`/guilds/${guild_id}/mute`,{
            mute_seconds:`${seconds}`,
            mute_end_timestamp:`${end_time}`
        })
        return result.status===204

    }
    async unMuteGuildMembers(guild_id:string,member_ids:string[]){
        return this.muteGuildMembers(guild_id,member_ids,0,0)
    }
    async muteGuildMembers(guild_id:string,member_ids:string[],seconds:number,end_time?:number){
        const result=await this.request.put(`/guilds/${guild_id}/mute`,{
            mute_seconds:`${seconds}`,
            mute_end_timestamp:`${end_time}`,
            user_ids:member_ids
        })
        return result.status===200
    }
    async addGuildMemberRoles(guild_id:string,channel_id:string,member_id:string,role_id:string){
        const result=await this.request.put(`/guilds/${guild_id}/members/${member_id}/roles/${role_id}`,{id:channel_id})
        return result.status===204
    }
    async removeGuildMemberRoles(guild_id:string,channel_id:string,member_id:string,role_id:string){
        const result=await this.request.delete(`/guilds/${guild_id}/members/${member_id}/roles/${role_id}`,{data:{id:channel_id}})
        return result.status===204
    }
    async kickGuildMember(guild_id:string,member_id:string,clean:-1|0|3|7|15|30=0,blacklist?: boolean){
        const result=await this.request.delete(`/guilds/${guild_id}/members/${member_id}`,{data:{
                add_blacklist: blacklist,
                delete_message_days: clean
            }})
        return result.status===204
    }
    async unMuteGuildMember(guild_id:string,member_id:string){
        return this.muteGuildMember(guild_id,member_id,0,0)
    }
    async muteGuildMember(guild_id:string,member_id:string,seconds:number,end_time?:number){
        const result=await this.request.put(`/guilds/${guild_id}/members/${member_id}/mute`,{
            mute_seconds:`${seconds}`,
            mute_end_timestamp:`${end_time}`
        })
        return result.status===204
    }

    async getGuildList() {
        const _getGuildList = async (after: string = undefined) => {
            const res = await this.request.get('/users/@me/guilds', {
                params: {
                    after
                }
            }).catch(()=>({data:[]}))// 私域不支持获取频道列表，做个兼容
            if (!res.data?.length) return []
            const result = (res.data || []).map(g => {
                const {id:guild_id,name:guild_name, joined_at, ...guild } = g
                return {
                    guild_id,
                    guild_name,
                    join_time: new Date(joined_at).getTime() / 1000,
                    ...guild
                }
            })
            const last = result[result.length - 1]
            return [...result, ...await _getGuildList(last.guild_id)]
        }
        return await _getGuildList()
    }

    async getGuildMemberList(guild_id: string) {
        const _getGuildMemberList = async (after: string = undefined) => {
            const res = await this.request.get(`/guilds/${guild_id}/members`, {
                params: {
                    after,
                    limit: 100
                }
            }).catch(()=>({data:[]}))// 公域没有权限，做个兼容
            if (!res.data?.length) return []
            const result = (res.data || []).map(m => {
                const { id: member_id,name:member_name, role, join_time, ...member } = m
                return {
                    member_id,
                    member_name,
                    role,
                    join_time: new Date(join_time).getTime() / 1000,
                    ...member
                }
            })
            const last = result[result.length - 1]
            return [...result, ...await _getGuildMemberList(last.member_id)]
        }
        return await _getGuildMemberList()
    }
    async getGuildMemberInfo(guild_id: string, member_id: string) {
        const { data:result }=await this.request.get(`/guilds/${guild_id}/members/${member_id}`)
        return result
    }
    async getChannelInfo(channel_id: string) {
        const {data:result} = await this.request.get(`/channels/${channel_id}`)
        return result
    }
    async getGroupMemberList(group_id: string) {
        throw UnsupportedMethodError
    }
    async getGroupMemberInfo(group_id: string, member_id: string) {
        throw UnsupportedMethodError
    }
    async getFriendList() {
        throw UnsupportedMethodError
    }
    async getFriendInfo(friend_id: string) {
        throw UnsupportedMethodError
    }

    async getChannelList(guild_id: string) {
        const {data:result=[]} = await this.request.get(`/guilds/${guild_id}/channels`)
        return result.map(({id:channel_id,name:channel_name,...channel})=>{
            return {
                channel_id,
                channel_name,
                ...channel
            }
        })
    }

    async sendPrivateMessage(user_id: string, message: Sendable, source?: Quotable) {
        const { hasMessages, messages, brief, hasFiles, files } = await Message.format.call(this, message, source)
        let message_id = ''
        if (hasMessages) {
            let { data: { id } } = await this.request.post(`/v2/users/${user_id}/messages`, messages)
            message_id = id
        }
        if (hasFiles) {
            let { data: { id } } = await this.request.post(`/v2/users/${user_id}/files`, files)
            if (message_id) message_id = `${message_id}|`
            message_id = message_id + id
        }
        this.logger.info(`send to User(${user_id}): ${brief}`)
        return {
            message_id,
            timestamp: new Date().getTime() / 1000
        }
    }
    async createDirectSession(guild_id:string,user_id:string){
        const {data:result}=await this.request.post(`/users/@me/dms`,{
            recipient_id:user_id,
            source_guild_id:guild_id
        })
        return result
    }
    async sendDirectMessage(guild_id:string,message:Sendable,source?:Quotable){
        const { hasMessages, messages, brief, hasFiles, files } =await Message.format.call(this, message, source)
        let message_id = ''
        if (hasMessages) {
            let { data: { id } } = await this.request.post(`/dms/${guild_id}/messages`, messages)
            message_id = id
        }
        if (hasFiles) {
            let { data: { id } } = await this.request.post(`/dms/${guild_id}/files`, files)
            if (message_id) message_id = `${message_id}|`
            message_id = message_id + id
        }
        this.logger.info(`send to Direct(${guild_id}): ${brief}`)
        return {
            message_id,
            timestamp: new Date().getTime() / 1000
        }
    }
    async sendGuildMessage(channel_id: string, message: Sendable, source?: Quotable) {
        const { hasMessages, messages, brief, hasFiles, files } =await Message.format.call(this, message, source)
        let message_id = ''
        if (hasMessages) {
            let { data: { id } } = await this.request.post(`/channels/${channel_id}/messages`, messages)
            message_id = id
        }
        if (hasFiles) {
            console.log(files)
            let { data: { id } } = await this.request.post(`/channels/${channel_id}/files`, files)
            if (message_id) message_id = `${message_id}|`
            message_id = message_id + id
        }
        this.logger.info(`send to Channel(${channel_id}): ${brief}`)
        return {
            message_id,
            timestamp: new Date().getTime() / 1000
        }
    }
    async sendGroupMessage(group_id: string, message: Sendable, source?: Quotable) {
        const { hasMessages, messages, brief, hasFiles, files } =await Message.format.call(this, message, source)
        let message_id: string = ''
        if (hasMessages) {
            const { data: result } = await this.request.post(`/v2/groups/${group_id}/messages`, messages)
            message_id = result.seq
        }
        if (hasFiles) {
            let { data: { id } } = await this.request.post(`/v2/groups/${group_id}/files`, files)
            if (message_id) message_id = `${message_id}|`
            message_id = message_id + id
        }
        this.logger.info(`send to Group(${group_id}): ${brief}`)
        return {
            message_id,
            timestamp: new Date().getTime() / 1000
        }
    }

    dispatchEvent(event: string, wsRes: any) {
        this.logger.debug(event, wsRes)
        const payload = wsRes.d;
        const event_id = wsRes.id || '';
        if (!payload || !event) return;
        const transformEvent = QQEvent[event] || 'system'
        this.em(transformEvent, this.processPayload(event_id, transformEvent, payload));
    }

    em(event: string, payload: Dict) {
        const eventNames = event.split('.')
        const [post_type,detail_type,...sub_type] = eventNames
        Object.assign(payload,{
            post_type,
            [`${post_type}_type`]: detail_type,
            sub_type: sub_type.join('.'),
            ...payload
        })
        let prefix = ''
        while (eventNames.length) {
            let fullEventName = `${prefix}.${eventNames.shift()}`
            if (fullEventName.startsWith('.')) fullEventName = fullEventName.slice(1)
            this.emit(fullEventName, payload)
            prefix = fullEventName
        }
    }

}

export interface QQBot {
    on<T extends keyof EventMap>(event: T, callback: EventMap[T]): this

    on<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback: (...args: any[]) => void): this

    once<T extends keyof EventMap>(event: T, callback: EventMap[T]): this

    once<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback: (...args: any[]) => void): this

    off<T extends keyof EventMap>(event: T, callback?: EventMap[T]): this

    off<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback?: (...args: any[]) => void): this

    emit<T extends keyof EventMap>(event: T, ...args: Parameters<EventMap[T]>): boolean

    emit<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, ...args: any[]): boolean

    addListener<T extends keyof EventMap>(event: T, callback: EventMap[T]): this

    addListener<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback: (...args: any[]) => void): this

    addListenerOnce<T extends keyof EventMap>(event: T, callback: EventMap[T]): this

    addListenerOnce<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback: (...args: any[]) => void): this

    removeListener<T extends keyof EventMap>(event: T, callback?: EventMap[T]): this

    removeListener<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback?: (...args: any[]) => void): this

    removeAllListeners<T extends keyof EventMap>(event: T): this

    removeAllListeners<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>): this

}

export namespace QQBot {

    export interface Token {
        access_token: string
        expires_in: number
        cache: string
    }

    export interface Config {
        appid: string
        secret: string
        token?: string
        sandbox?: boolean
        maxRetry?: number
        /**
         * 是否移除第一个@
         */
        removeAt?: boolean
        delay?:Dict<number>
        intents?: string[]
        logLevel?: LogLevel
    }
    export function getFullTargetId(message:GuildMessageEvent|GroupMessageEvent|PrivateMessageEvent){
        switch (message.sub_type){
            case "private":
                return message.user_id
            case "group":
                return `${(message as GroupMessageEvent).group_id}:${message.user_id}`
            case "guild":
                return `${(message as GuildMessageEvent).guild_id}:${(message as GuildMessageEvent).channel_id}:${message.user_id}`
        }
    }
}
