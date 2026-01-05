import { ImHelper } from '../imhelper.js';
import { GroupMember } from './groupMember.js';
import type { Message } from '../message.js';
export class Group<Id extends string | number=string|number> {
    constructor(public helper: ImHelper<Id>,public info: Group.Data<Id>) {
    }
    get group_id() {
        return this.info.group_id;
    }
    get groupName() {
        return this.info.group_name;
    }
    get avatar() {
        return this.info.avatar;
    }
    get members(){
        return Array.from(this.helper.$groupMemberMap.get(this.group_id)?.values() || [])
    }
    setAdmin(userId: Id){
        return this.helper.adapter.setGroupMemberAdmin(this.group_id, userId, true);
    }
    setOwner(userId: Id){
        return this.helper.adapter.setGroupMemberOwner(this.group_id, userId, true);
    }
    kickMember(userId: Id){
        return this.helper.adapter.kickGroupMember(this.group_id, userId);
    }
    muteMember(userId: Id, duration: number){
        return this.helper.adapter.setGroupMemberMute(this.group_id, userId, duration);
    }
    sendMessage(message: Message.Content) {
        return this.helper.adapter.sendMessage({
            scene_type: 'group',
            scene_id: this.group_id,
            message: message,
        });
    }
    setName(name: string) {
        return this.helper.adapter.setGroupName(this.group_id, name);
    }
    leave() {
        return this.helper.adapter.leaveGroup(this.group_id);
    }
    async refresh() {
        const updated = await this.helper.adapter.getGroupInfo(this.group_id);
        this.info = updated.info;
        return this;
    }
    async refreshMembers() {
        const members = await this.helper.adapter.getGroupMemberList(this.group_id);
        const memberMap = new Map<Id, GroupMember.Data<Id>>();
        for (const member of members) {
            memberMap.set(member.user_id, {
                user_id: member.user_id,
                user_name: member.user_name,
                avatar: member.avatar,
                group_id: this.group_id,
            });
        }
        this.helper.$groupMemberMap.set(this.group_id, memberMap);
        return this.members;
    }
}
export namespace Group {
    export interface Data<Id extends string | number=string|number> {
        group_id: Id;
        group_name: string;
        avatar: string;
    }
    export const cache:WeakMap<Data<string | number>, Group<string | number>> = new WeakMap();
    export function from<Id extends string | number=string|number>(this: ImHelper<Id>, groupId: Id): Group<Id>{
        const data = this.$groupMap.get(groupId);
        if (!data) {
            throw new Error(`Group ${groupId} not found`);
        }
        if(cache.has(data as Data<string | number>)) return cache.get(data as Data<string | number>)! as Group<Id>;
        const group = new Group(this, data);
        cache.set(data as Data<string | number>, group as Group<string | number>);
        return group;
    }
}