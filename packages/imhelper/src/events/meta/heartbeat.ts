import { MetaEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 心跳元事件
 */
export class HeartbeatMetaEvent<
    Id extends string | number = string | number,
> extends MetaEvent<Id> {
    readonly type = 'meta' as const;
    readonly meta_type = 'heartbeat' as const;
    readonly interval?: number;

    constructor(
        helper: ImHelper<Id>,
        data: HeartbeatMetaEvent.Data<Id>
    ) {
        super(helper, {
            ...data,
            meta_type: 'heartbeat',
        });
        this.interval = data.interval;
    }
}

export namespace HeartbeatMetaEvent {
    export interface Data<Id extends string | number = string | number> extends MetaEvent.Data<Id> {
        interval?: number;
    }
}
