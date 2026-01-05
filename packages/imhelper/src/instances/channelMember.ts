import { ImHelper } from '../imhelper.js';
import { User } from './user.js';
// @ts-expect-error - 静态方法 from 的签名不同是预期的，因为需要额外的 channelId 参数
export class ChannelMember<Id extends string | number=string|number> extends User<Id> {
    constructor(public helper: ImHelper<Id>, public info: ChannelMember.Data<Id>) {
        super(helper, info);
    }
    get channel_id() {
        return this.info.channel_id;
    }
    get channel(){
        return this.helper.pickChannel(this.channel_id);
    }
    setAdmin(){
        return this.helper.adapter.setChannelMemberAdmin(this.channel_id, this.user_id, true);
    }
    setOwner(){
        return this.helper.adapter.setChannelMemberOwner(this.channel_id, this.user_id, true);
    }
    unsetAdmin(){
        return this.helper.adapter.unsetChannelMemberAdmin(this.channel_id, this.user_id);
    }
    unsetOwner(){
        return this.helper.adapter.unsetChannelMemberOwner(this.channel_id, this.user_id);
    }
    async refresh() {
        const updated = await this.helper.adapter.getChannelMemberInfo(this.channel_id, this.user_id);
        this.info = {
            ...updated.info,
            channel_id: this.channel_id,
        };
        return this;
    }
}
export namespace ChannelMember {
    export const cache:WeakMap<Data<string | number>, ChannelMember<string | number>> = new WeakMap();
    export interface Data<Id extends string | number=string|number> extends User.Data<Id> {
        channel_id: Id;
        role?: 'owner' | 'admin' | 'member';
    }
    export function from<Id extends string | number=string|number>(this: ImHelper<Id>,channel_id: Id, userId: Id): ChannelMember<Id>{
        const data=this.$channelMemberMap.get(channel_id)?.get(userId);
        if (!data) {
            throw new Error(`member ${userId} of channel ${channel_id} not found`);
        }
        if(cache.has(data as Data<string | number>)) return cache.get(data as Data<string | number>)! as ChannelMember<Id>;
        const channelMember = new ChannelMember(this, data);
        cache.set(data as Data<string | number>, channelMember as ChannelMember<string | number>);
        return channelMember;
    }
}