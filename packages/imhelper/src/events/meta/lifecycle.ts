import { MetaEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';

/**
 * 生命周期元事件
 */
export class LifecycleMetaEvent<
    Id extends string | number = string | number,
> extends MetaEvent<Id> {
    readonly type = 'meta' as const;
    readonly meta_type = 'lifecycle' as const;
    readonly sub_type: 'enable' | 'disable' | 'connect';

    constructor(
        helper: ImHelper<Id>,
        data: LifecycleMetaEvent.Data<Id>
    ) {
        super(helper, {
            ...data,
            meta_type: 'lifecycle',
        });
        this.sub_type = data.sub_type;
    }
}

export namespace LifecycleMetaEvent {
    export interface Data<Id extends string | number = string | number> extends MetaEvent.Data<Id> {
        sub_type: 'enable' | 'disable' | 'connect';
    }
}
