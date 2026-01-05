import { NoticeEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 群消息删除通知事件
 */
export class GroupMessageDeleteNoticeEvent<
    Id extends string | number = string | number,
> extends NoticeEvent<Id> {
    readonly type = 'notice' as const;
    readonly group_id: Id;
    readonly message_id: Id;
    readonly operator_id?: Id;

    #group?: import('../../instances/group.js').Group<Id>;
    #operator?: import('../../instances/user.js').User<Id>;

    constructor(
        helper: ImHelper<Id>,
        data: GroupMessageDeleteNoticeEvent.Data<Id>
    ) {
        super(helper, data);
        this.group_id = data.group_id;
        this.message_id = data.message_id;
        this.operator_id = data.operator_id;
    }

    get group() {
        if (!this.#group) {
            this.#group = this.helper.pickGroup(this.group_id);
        }
        return this.#group;
    }

    get operator() {
        if (this.operator_id) {
            if (!this.#operator) {
                this.#operator = this.helper.pickUser(this.operator_id);
            }
            return this.#operator;
        }
        return undefined;
    }
}

export namespace GroupMessageDeleteNoticeEvent {
    export interface Data<Id extends string | number = string | number> extends NoticeEvent.Data<Id> {
        group_id: Id;
        message_id: Id;
        operator_id?: Id;
        notice_type: 'group_message_delete';
        sub_type: 'delete';
    }
}
