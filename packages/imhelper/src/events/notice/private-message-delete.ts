import { NoticeEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 私聊消息删除通知事件
 */
export class PrivateMessageDeleteNoticeEvent<
    Id extends string | number = string | number,
> extends NoticeEvent<Id> {
    readonly type = 'notice' as const;
    readonly user_id: Id;
    readonly message_id: Id;

    #user?: import('../../instances/user.js').User<Id>;

    constructor(
        helper: ImHelper<Id>,
        data: PrivateMessageDeleteNoticeEvent.Data<Id>
    ) {
        super(helper, data);
        this.user_id = data.user_id;
        this.message_id = data.message_id;
    }

    get user() {
        if (!this.#user) {
            this.#user = this.helper.pickUser(this.user_id);
        }
        return this.#user;
    }
}

export namespace PrivateMessageDeleteNoticeEvent {
    export interface Data<Id extends string | number = string | number> extends NoticeEvent.Data<Id> {
        user_id: Id;
        message_id: Id;
        notice_type: 'private_message_delete';
        sub_type: 'delete';
    }
}
