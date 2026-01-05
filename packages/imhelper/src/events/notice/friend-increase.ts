import { NoticeEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 好友增加通知事件
 */
export class FriendIncreaseNoticeEvent<
    Id extends string | number = string | number,
> extends NoticeEvent<Id> {
    readonly type = 'notice' as const;
    readonly user_id: Id;

    #user?: import('../../instances/user.js').User<Id>;
    #friend?: import('../../instances/friend.js').Friend<Id>;

    constructor(
        helper: ImHelper<Id>,
        data: FriendIncreaseNoticeEvent.Data<Id>
    ) {
        super(helper, data);
        this.user_id = data.user_id;
    }

    get user() {
        if (!this.#user) {
            this.#user = this.helper.pickUser(this.user_id);
        }
        return this.#user;
    }

    get friend() {
        if (!this.#friend) {
            this.#friend = this.helper.pickFriend(this.user_id);
        }
        return this.#friend;
    }
}

export namespace FriendIncreaseNoticeEvent {
    export interface Data<Id extends string | number = string | number> extends NoticeEvent.Data<Id> {
        user_id: Id;
        notice_type: 'friend_increase';
        sub_type: 'add';
    }
}
