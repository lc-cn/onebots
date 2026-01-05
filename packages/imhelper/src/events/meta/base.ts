import { BaseEvent } from '../base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 元事件抽象基类
 */
export abstract class MetaEvent<
    Id extends string | number = string | number,
> extends BaseEvent<Id> {
    abstract readonly type: 'meta';
    abstract readonly meta_type: 'lifecycle' | 'heartbeat' | 'status_update';

    constructor(
        helper: ImHelper<Id>,
        data: MetaEvent.Data<Id>
    ) {
        super(helper, data);
    }
}

export namespace MetaEvent {
    export interface Data<Id extends string | number = string | number> extends BaseEvent.Data<Id> {
        meta_type: 'lifecycle' | 'heartbeat' | 'status_update';
    }
}
