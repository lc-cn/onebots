import { BaseEvent } from '../base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 请求事件抽象基类
 */
export abstract class RequestEvent<
    Id extends string | number = string | number,
> extends BaseEvent<Id> {
    abstract readonly type: 'request';
    abstract readonly request_type: 'friend' | 'group';
    readonly request_id: Id;
    readonly user_id: Id;
    readonly comment?: string;
    readonly flag?: string;

    constructor(
        helper: ImHelper<Id>,
        data: RequestEvent.Data<Id>
    ) {
        super(helper, data);
        this.request_id = data.request_id;
        this.user_id = data.user_id;
        this.comment = data.comment;
        this.flag = data.flag;
    }

    /**
     * 批准请求
     */
    approve(comment?: string): Promise<void> {
        if (this.request_type === 'friend') {
            return this.helper.approveFriendRequest(this.request_id, true, comment);
        } else {
            return this.helper.approveGroupRequest(this.request_id, true, comment);
        }
    }

    /**
     * 拒绝请求
     */
    reject(reason?: string): Promise<void> {
        if (this.request_type === 'friend') {
            return this.helper.approveFriendRequest(this.request_id, false, reason);
        } else {
            return this.helper.approveGroupRequest(this.request_id, false, reason);
        }
    }
}

export namespace RequestEvent {
    export interface Data<Id extends string | number = string | number> extends BaseEvent.Data<Id> {
        request_id: Id;
        user_id: Id;
        comment?: string;
        flag: string;
    }
}
