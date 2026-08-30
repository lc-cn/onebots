import { MessageEvent } from "./base.js";
import type { ImHelper } from "../../imhelper.js";

/**
 * 私聊消息事件
 */
export class PrivateMessageEvent<
    Id extends string | number = string | number,
> extends MessageEvent<Id> {
    readonly type = "message" as const;
    readonly message_type = "private" as const;
    readonly sub_type?: "friend" | "group" | "other";
    readonly channel_id?: Id;

    constructor(helper: ImHelper<Id>, data: PrivateMessageEvent.Data<Id>) {
        super(helper, data);
        this.sub_type = data.sub_type;
        this.channel_id = data.channel_id;
    }

    protected getSceneId(): Id {
        return this.user_id;
    }

    protected override getMessageContext() {
        return { ...super.getMessageContext(), channel_id: this.channel_id };
    }
}
export namespace PrivateMessageEvent {
    export interface Data<
        Id extends string | number = string | number,
    > extends MessageEvent.Data<Id> {
        message_type: "private";
        channel_id?: Id;
        sub_type?: "friend" | "group" | "other";
    }
}
