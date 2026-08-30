import type { ImHelper } from "../../imhelper.js";
import { NoticeEvent } from "./base.js";

/** 频道消息删除通知，保留频道与可选公会上下文。 */
export class ChannelMessageDeleteNoticeEvent<
    Id extends string | number = string | number,
> extends NoticeEvent<Id> {
    readonly type = "notice" as const;
    readonly channel_id: Id;
    readonly guild_id?: Id;
    readonly message_id: Id;
    readonly user_id?: Id;
    readonly operator_id?: Id;

    constructor(helper: ImHelper<Id>, data: ChannelMessageDeleteNoticeEvent.Data<Id>) {
        super(helper, data);
        this.channel_id = data.channel_id;
        this.guild_id = data.guild_id;
        this.message_id = data.message_id;
        this.user_id = data.user_id;
        this.operator_id = data.operator_id;
    }
}

export namespace ChannelMessageDeleteNoticeEvent {
    export interface Data<
        Id extends string | number = string | number,
    > extends NoticeEvent.Data<Id> {
        notice_type: "channel_message_delete";
        sub_type: "delete";
        channel_id: Id;
        guild_id?: Id;
        message_id: Id;
        user_id?: Id;
        operator_id?: Id;
    }
}
