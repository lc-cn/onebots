import { RequestEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 加好友请求事件
 */
export class FriendRequestEvent<
    Id extends string | number = string | number,
> extends RequestEvent<Id> {
    readonly type = 'request' as const;
    readonly request_type = 'friend' as const;
    readonly user_id: Id;
    readonly flag: string;

    #user?: import('../../instances/user.js').User<Id>;

    constructor(
        helper: ImHelper<Id>,
        data: FriendRequestEvent.Data<Id>
    ) {
        super(helper, {
            ...data,
            request_type: 'friend',
        });
        this.user_id = data.user_id;
        this.flag = data.flag;
    }

    get user() {
        if (!this.#user) {
            this.#user = this.helper.pickUser(this.user_id);
        }
        return this.#user;
    }

    approve(): Promise<void> {
        return this.helper.approveFriendRequest(this.request_id, true);
    }

    reject(reason?: string): Promise<void> {
        return this.helper.approveFriendRequest(this.request_id, false, reason);
    }
}

export namespace FriendRequestEvent {
    export interface Data<Id extends string | number = string | number> extends RequestEvent.Data<Id> {
        user_id: Id;
        flag: string;
    }
}
