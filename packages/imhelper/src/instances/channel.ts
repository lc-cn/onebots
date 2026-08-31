import { ImHelper } from '../imhelper.js';
import { ChannelMember } from './channelMember.js';
import type { Message } from '../message.js';
export class Channel<Id extends string | number=string|number> {
    constructor(public helper: ImHelper<Id>, public info: Channel.Data<Id>) {
    }
    get channel_id() {
        return this.info.channel_id;
    }
    get channel_name() {
        return this.info.channel_name;
    }
    get avatar() {
        return this.info.avatar;
    }
    get members(){
        return Array.from(this.helper.$channelMemberMap.get(this.channel_id)?.values() || [])
    }
    setAdmin(userId: Id){
        return this.helper.adapter.setChannelMemberAdmin(this.channel_id, userId, true);
    }
    setOwner(userId: Id){
        return this.helper.adapter.setChannelMemberOwner(this.channel_id, userId, true);
    }
    sendMessage(message: Message.Content) {
        return this.helper.adapter.sendMessage({
            scene_type: 'channel',
            scene_id: this.channel_id,
            message: message,
        });
    }
    setName(name: string) {
        return this.helper.adapter.setChannelName(this.channel_id, name);
    }
    leave() {
        return this.helper.adapter.leaveChannel(this.channel_id);
    }
    async refresh() {
        const updated = await this.helper.adapter.getChannelInfo(this.channel_id);
        this.info = updated.info;
        return this;
    }
    async refreshMembers() {
        const members = await this.helper.adapter.getChannelMemberList(this.channel_id);
        const memberMap = new Map<Id, ChannelMember.Data<Id>>();
        for (const member of members) {
            memberMap.set(member.user_id, {
                user_id: member.user_id,
                user_name: member.user_name,
                avatar: member.avatar,
                channel_id: this.channel_id,
            });
        }
        this.helper.$channelMemberMap.set(this.channel_id, memberMap);
        return this.members;
    }
}
export namespace Channel {
    export interface Data<Id extends string | number=string|number> {
        channel_id: Id;
        channel_name: string;
        avatar: string;
    }
    export const cache:WeakMap<Data<string | number>, Channel<string | number>> = new WeakMap();
    export function from<Id extends string | number=string|number>(this: ImHelper<Id>, channel_id: Id): Channel<Id>{
        const data = this.$channelMap.get(channel_id);
        if (!data) {
            throw new Error(`Channel ${channel_id} not found`);
        }
        if(cache.has(data as Data<string | number>)) return cache.get(data as Data<string | number>)! as Channel<Id>;
        const channel = new Channel(this, data);
        cache.set(data as Data<string | number>, channel as Channel<string | number>);
        return channel;
    }
}