import { ImHelper } from '../imhelper.js';
import { User } from './user.js';
export class Friend<Id extends string | number=string|number> extends User<Id> {
    constructor(public helper: ImHelper<Id>, public info: Friend.Data<Id>) {
        super(helper, info);
    }
    get remark() {
        return this.info.remark;
    }
    delete() {
        return this.helper.adapter.deleteFriend(this.user_id);
    }
    async refresh() {
        const updated = await this.helper.adapter.getFriendInfo(this.user_id);
        this.info = updated.info;
        return this;
    }
}
export namespace Friend {
    export interface Data<Id extends string | number=string|number> extends User.Data<Id> {
        remark?: string;
    }
    export const cache:WeakMap<Data<string | number>, Friend<string | number>> = new WeakMap();
    export function from<Id extends string | number=string|number>(this: ImHelper<Id>, friendId: Id): Friend<Id>{
        const data = this.$friendMap.get(friendId);
        if (!data) {
            throw new Error(`Friend ${friendId} not found`);
        }
        if(cache.has(data as Data<string | number>)) return cache.get(data as Data<string | number>)! as Friend<Id>;
        const friend = new Friend(this, data);
        cache.set(data as Data<string | number>, friend as Friend<string | number>);
        return friend;
    }
}