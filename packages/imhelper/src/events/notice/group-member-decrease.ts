import { NoticeEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 群成员减少通知事件
 */
export class GroupMemberDecreaseNoticeEvent<
    Id extends string | number = string | number,
> extends NoticeEvent<Id> {
    readonly type = 'notice' as const;
    readonly group_id: Id;
    readonly user_id: Id;
    readonly operator_id?: Id;

    #user?: import('../../instances/user.js').User<Id>;
    #group?: import('../../instances/group.js').Group<Id>;
    #operator?: import('../../instances/user.js').User<Id>;

    constructor(
        helper: ImHelper<Id>,
        data: GroupMemberDecreaseNoticeEvent.Data<Id>
    ) {
        super(helper, data);
        this.group_id = data.group_id;
        this.user_id = data.user_id;
        this.operator_id = data.operator_id;
    }

    get user() {
        if (!this.#user) {
            this.#user = this.helper.pickUser(this.user_id);
        }
        return this.#user;
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

export namespace GroupMemberDecreaseNoticeEvent {
    export interface Data<Id extends string | number = string | number> extends NoticeEvent.Data<Id> {
        group_id: Id;
        user_id: Id;
        notice_type: 'group_member_decrease';
        operator_id?: Id;
        sub_type: 'leave' | 'kick' | 'kick_me';
    }
}
