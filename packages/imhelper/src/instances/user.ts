import { ImHelper } from '../imhelper.js';
import type { Message } from '../message.js';
import { Friend } from './friend.js';
import { GroupMember } from './groupMember.js';
import { ChannelMember } from './channelMember.js';
export class User<Id extends string | number=string|number> {
    constructor(public helper: ImHelper<Id>, public info: User.Data<Id>) {
    }
    get user_id(): Id {
        return this.info.user_id;
    }
    get user_name() {
        return this.info.user_name;
    }
    get avatar() {
        return this.info.avatar;
    }
    asFriend(): Friend<Id> {
        return this.helper.pickFriend(this.user_id);
    }
    asGroupMember(groupId: Id): GroupMember<Id> {
        return this.helper.pickGroupMember(groupId, this.user_id);
    }
    asChannelMember(channelId: Id): ChannelMember<Id> {
        return this.helper.pickChannelMember(channelId, this.user_id);
    }
    sendMessage(message: Message.Content) {
        return this.helper.adapter.sendMessage({
            scene_type: 'private',
            scene_id: this.user_id,
            message: message,
        });
    }
    async refresh() {
        const updated = await this.helper.adapter.getUserInfo(this.user_id);
        this.info = updated.info;
        return this;
    }
}
export namespace User {
    export interface Data<Id extends string | number=string|number> {
        user_id: Id;
        user_name: string;
        avatar: string;
    }
    export const cache:WeakMap<Data<string | number>, User<string | number>> = new WeakMap();
    export function from<Id extends string | number=string|number>(this: ImHelper<Id>, userId: Id): User<Id>{
        const data = this.$userMap.get(userId);
        if (!data) {
            throw new Error(`User ${userId} not found`);
        }
        if(cache.has(data as Data<string | number>)) return cache.get(data as Data<string | number>)! as User<Id>;
        const user = new User(this, data);
        cache.set(data as Data<string | number>, user as User<string | number>);
        return user;
    }
}