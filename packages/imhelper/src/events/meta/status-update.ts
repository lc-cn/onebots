import { MetaEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 状态更新元事件
 */
export class StatusUpdateMetaEvent<
    Id extends string | number = string | number,
> extends MetaEvent<Id> {
    readonly type = 'meta' as const;
    readonly meta_type = 'status_update' as const;
    readonly status: {
        online: boolean;
        good: boolean;
    };

    constructor(
        helper: ImHelper<Id>,
        data: StatusUpdateMetaEvent.Data<Id>
    ) {
        super(helper, {
            ...data,
            meta_type: 'status_update',
        });
        this.status = data.status;
    }
}

export namespace StatusUpdateMetaEvent {
    export interface Data<Id extends string | number = string | number> extends MetaEvent.Data<Id> {
        status: {
            online: boolean;
            good: boolean;
        };
    }
}
