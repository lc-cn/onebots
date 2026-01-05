import { MessageEvent } from './base.js';
import type { ImHelper } from '../../imhelper.js';
import type { Message } from '../../message.js';

/**
 * 频道消息事件
 */
export class ChannelMessageEvent<
    Id extends string | number = string | number
> extends MessageEvent<Id> {
    readonly type = 'message' as const;
    readonly message_type = 'channel' as const;
    readonly channel_id: Id;
    readonly guild_id?: Id;
    #channel?: import('../../instances/channel.js').Channel<Id>;
    #member?: import('../../instances/channelMember.js').ChannelMember<Id>;
    get channel(){
        if (!this.#channel) {
            this.#channel = this.helper.pickChannel(this.channel_id);
        }
        return this.#channel;
    }
    get member(){
        if (!this.#member) {
            this.#member = this.helper.pickChannelMember(this.channel_id, this.user_id);
        }
        return this.#member;
    }
    constructor(
        helper: ImHelper<Id>,
        data: ChannelMessageEvent.Data<Id>
    ) {
        super(helper, data);
        this.channel_id = data.channel_id;
        this.guild_id = data.guild_id;
    }

    protected getSceneId(): Id {
        return this.channel_id;
    }
    /**
     * 添加反应
     */
    addReaction(reaction: string): Promise<void> {
        return this.helper.adapter.addMessageReaction(this.message_id, reaction);
    }

    /**
     * 移除反应
     */
    removeReaction(reaction: string): Promise<void> {
        return this.helper.adapter.deleteMessageReaction(this.message_id, reaction);
    }
}

export namespace ChannelMessageEvent {
    export interface Data<Id extends string | number = string | number> extends MessageEvent.Data<Id> {
        channel_id: Id;
        guild_id?: Id;
    }
}
