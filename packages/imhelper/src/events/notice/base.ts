import { BaseEvent } from '../base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 通知事件抽象基类
 */
export abstract class NoticeEvent<
    Id extends string | number = string | number,
> extends BaseEvent<Id> {
    abstract readonly type: 'notice';
    readonly notice_type: string;
    readonly sub_type: string;

    constructor(
        helper: ImHelper<Id>,
        data: NoticeEvent.Data<Id>
    ) {
        super(helper, data);
        this.notice_type = data.notice_type;
        this.sub_type = data.sub_type;
    }
}

export namespace NoticeEvent {
    export interface Data<Id extends string | number = string | number> extends BaseEvent.Data<Id> {
        notice_type: string;
        sub_type: string;
    }
}
