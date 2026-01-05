import { NoticeEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 好友减少通知事件
 */
export class FriendDecreaseNoticeEvent<
    Id extends string | number = string | number,
> extends NoticeEvent<Id> {
    readonly type = 'notice' as const;
    readonly user_id: Id;

    #user?: import('../../instances/user.js').User<Id>;

    constructor(
        helper: ImHelper<Id>,
        data: FriendDecreaseNoticeEvent.Data<Id>
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
}
export namespace FriendDecreaseNoticeEvent {
    export interface Data<Id extends string | number = string | number> extends NoticeEvent.Data<Id> {
        user_id: Id;
        notice_type: 'friend_decrease';
        sub_type: 'delete' | 'remove';
    }
}

