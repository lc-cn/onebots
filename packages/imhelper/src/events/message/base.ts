import { BaseEvent } from '../base.js';
import type { ImHelper } from '../../imhelper.js';
import type { Message } from '../../message.js';

/**
 * 消息事件抽象基类
 */
export abstract class MessageEvent<
    Id extends string | number = string | number,
> extends BaseEvent<Id> {
    abstract readonly type: 'message';
    readonly message_type: Message.SceneType;
    readonly sub_type?: string;
    readonly message_id: Id;
    readonly user_id: Id;
    readonly content: Message.Content;
    readonly raw_message?: string;
    #sender?: import('../../instances/user.js').User<Id>;
    get sender(){
        if (!this.#sender) {
            this.#sender = this.helper.pickUser(this.user_id);
        }
        return this.#sender;
    }
    constructor(
        helper: ImHelper<Id>,
        data: MessageEvent.Data<Id>
    ) {
        super(helper, data);
        this.message_type = data.message_type;
        this.sub_type = data.sub_type;
        this.message_id = data.message_id;
        this.user_id = data.user_id;
        this.content = data.content;
        this.raw_message = data.raw_message;
    }

    /**
     * 获取场景ID（根据消息类型返回对应的ID）
     */
    protected abstract getSceneId(): Id;

    /**
     * 回复消息
     */
    reply(message: Message.Content): Promise<Message.Ret> {
        return this.helper.adapter.sendMessage({
            scene_type: this.message_type,
            scene_id: this.getSceneId(),
            message: message,
        });
    }

    /**
     * 撤回消息
     */
    recall(): Promise<boolean> {
        return this.helper.adapter.recallMessage(this.message_id);
    }

    /**
     * 编辑消息
     */
    edit(content: Message.Content): Promise<void> {
        return this.helper.adapter.updateMessage(this.message_id, content);
    }
}

export namespace MessageEvent {
    export interface Data<Id extends string | number = string | number> extends BaseEvent.Data<Id> {
        message_id: Id;
        user_id: Id;
        content: Message.Content;
        message_type: Message.SceneType;
        sub_type?: string;
        raw_message?: string;
    }
}
