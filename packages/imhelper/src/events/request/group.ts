import { RequestEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 加群请求事件
 */
export class GroupRequestEvent<
    Id extends string | number = string | number,
> extends RequestEvent<Id> {
    readonly type = 'request' as const;
    readonly request_type = 'group' as const;
    readonly group_id: Id;
    readonly user_id: Id;
    readonly flag: string;
    readonly sub_type: 'add' | 'invite';

    #user?: import('../../instances/user.js').User<Id>;
    #group?: import('../../instances/group.js').Group<Id>;

    constructor(
        helper: ImHelper<Id>,
        data: GroupRequestEvent.Data<Id>
    ) {
        super(helper, {
            ...data,
            request_type: 'group',
        });
        this.group_id = data.group_id;
        this.user_id = data.user_id;
        this.flag = data.flag;
        this.sub_type = data.sub_type;
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

    approve(): Promise<void> {
        return this.helper.approveGroupRequest(this.request_id, true);
    }

    reject(reason?: string): Promise<void> {
        return this.helper.approveGroupRequest(this.request_id, false, reason);
    }
}

export namespace GroupRequestEvent {
    export interface Data<Id extends string | number = string | number> extends RequestEvent.Data<Id> {
        group_id: Id;
        user_id: Id;
        flag: string;
        sub_type: 'add' | 'invite';
    }
}
