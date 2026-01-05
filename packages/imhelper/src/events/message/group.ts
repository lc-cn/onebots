import { MessageEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';
import type { Message } from '../../message.js';
/**
 * 群聊消息事件
 */
export class GroupMessageEvent<
    Id extends string | number = string | number,
> extends MessageEvent<Id> {
    readonly type = 'message' as const;
    readonly message_type = 'group' as const;
    readonly group_id: Id;
    readonly sub_type?: 'normal' | 'anonymous' | 'notice';
    #group?: import('../../instances/group.js').Group<Id>;
    #member?: import('../../instances/groupMember.js').GroupMember<Id>;
    get group(){
        if (!this.#group) {
            this.#group = this.helper.pickGroup(this.group_id);
        }
        return this.#group;
    }
    get member(){
        if (!this.#member) {
            this.#member = this.helper.pickGroupMember(this.group_id, this.user_id);
        }
        return this.#member;
    }
    readonly anonymous?: {
        id: Id;
        name: string;
        flag: string;
    };

    constructor(
        helper: ImHelper<Id>,
        data: GroupMessageEvent.Data<Id>
    ) {
        super(helper, data);
        this.group_id = data.group_id;
        this.sub_type = data.sub_type;
        this.anonymous = data.anonymous;
    }

    protected getSceneId(): Id {
        return this.group_id;
    }
}

export namespace GroupMessageEvent {
    export interface Data<Id extends string | number = string | number> extends MessageEvent.Data<Id> {
        group_id: Id;
        sub_type?: 'normal' | 'anonymous' | 'notice';
        anonymous?: {
            id: Id;
            name: string;
            flag: string;
        };
    }
}
