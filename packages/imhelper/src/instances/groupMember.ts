import { ImHelper } from '../imhelper.js';
import { User } from './user.js';
// @ts-expect-error - 静态方法 from 的签名不同是预期的，因为需要额外的 groupId 参数
export class GroupMember<Id extends string | number=string|number> extends User<Id> {
    constructor(public helper: ImHelper<Id>, public info: GroupMember.Data<Id>) {
        super(helper, info);
    }
    get group_id() {
        return this.info.group_id;
    }
    get group(){
        return this.helper.pickGroup(this.group_id);
    }
    setAdmin(){
        return this.helper.adapter.setGroupMemberAdmin(this.group_id, this.user_id, true);
    }
    setOwner(){
        return this.helper.adapter.setGroupMemberOwner(this.group_id, this.user_id, true);
    }
    kick(){
            return this.helper.adapter.kickGroupMember(this.group_id, this.user_id);
    }
    mute(duration: number){
        return this.helper.adapter.setGroupMemberMute(this.group_id, this.user_id, duration);
    }
    unsetAdmin(){
        return this.helper.adapter.unsetGroupMemberAdmin(this.group_id, this.user_id);
    }
    unsetOwner(){
        return this.helper.adapter.unsetGroupMemberOwner(this.group_id, this.user_id);
    }
    setCard(card: string){
        return this.helper.adapter.setGroupMemberCard(this.group_id, this.user_id, card);
    }
    async refresh() {
        const updated = await this.helper.adapter.getGroupMemberInfo(this.group_id, this.user_id);
        this.info = {
            ...updated.info,
            group_id: this.group_id,
        };
        return this;
    }
}
export namespace GroupMember {
    export interface Data<Id extends string | number=string|number> extends User.Data<Id> {
        group_id: Id;
        role?: 'owner' | 'admin' | 'member';
        join_time?: number;
        last_sent_time?: number;
        level?: string;
        unfriendly?: boolean;
        title?: string;
        title_expire_time?: number;
        card_changeable?: boolean;
    }
    export const cache:WeakMap<Data<string | number>, GroupMember<string | number>> = new WeakMap();
    export function from<Id extends string | number=string|number>(this: ImHelper<Id>, groupId: Id, userId: Id): GroupMember<Id>{
        const data = this.$groupMemberMap.get(groupId)?.get(userId);
        if (!data) {
            throw new Error(`member ${userId} of group ${groupId} not found`);
        }
        if(cache.has(data as Data<string | number>)) return cache.get(data as Data<string | number>)! as GroupMember<Id>;
        const groupMember = new GroupMember(this, data);
        cache.set(data as Data<string | number>, groupMember as GroupMember<string | number>);
        return groupMember;
    }
}