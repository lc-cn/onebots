import { MessageEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';
import type { Message } from '../../message.js';

/**
 * 私聊消息事件
 */
export class PrivateMessageEvent<
    Id extends string | number = string | number,
> extends MessageEvent<Id> {
    readonly type = 'message' as const;
    readonly message_type = 'private' as const;
    readonly sub_type?: 'friend' | 'group' | 'other';
    
    constructor(
        helper: ImHelper<Id>,
        data: PrivateMessageEvent.Data<Id>
    ) {
        super(helper, data);
        this.sub_type = data.sub_type;
    }

    protected getSceneId(): Id {
        return this.user_id;
    }
}
export namespace PrivateMessageEvent {
    export interface Data<Id extends string | number = string | number> extends MessageEvent.Data<Id> {
        sub_type?: 'friend' | 'group' | 'other';
    }
}

