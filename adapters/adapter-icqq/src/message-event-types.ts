import type {
    Anonymous,
    GroupMessageEvent,
    MessageElem,
    PrivateMessage,
    PrivateMessageEvent,
} from "@icqqjs/icqq";

export interface ICQQMessageRet {
    message_id: string;
    seq: number;
    rand: number;
    time: number;
}

/** ICQQ 原生接收消息元素；未知运行时扩展仍使用显式 raw 分支。 */
export type ICQQMessageElement = MessageElem | { type: "icqq_raw"; data: unknown };

/** 私聊与跨设备同步消息的完整平台语义。 */
export interface ICQQPrivateMessageEvent {
    raw_event: PrivateMessage | PrivateMessageEvent;
    message_id: string;
    user_id: number;
    message: ICQQMessageElement[];
    raw_message: string;
    time: number;
    sub_type: "friend" | "group" | "other" | "self";
    from_uid: string;
    to_id: number;
    to_uid: string;
    auto_reply: boolean;
    sender: {
        user_id: number;
        user_uid: string;
        nickname: string;
        group_id: number | undefined;
        discuss_id: number | undefined;
    };
    reply?: (message: string | ICQQMessageElement[], quote?: boolean) => Promise<ICQQMessageRet>;
}

/** 群消息的完整发送者、匿名与提及语义。 */
export interface ICQQGroupMessageEvent {
    raw_event: GroupMessageEvent;
    message_id: string;
    group_id: number;
    user_id: number;
    message: ICQQMessageElement[];
    raw_message: string;
    time: number;
    sub_type: "normal" | "anonymous";
    anonymous: Anonymous | null;
    block: boolean;
    atme: boolean;
    atall: boolean;
    sender: {
        user_id: number;
        user_uid: string;
        nickname: string;
        sub_id: string;
        card: string;
        sex: "male" | "female" | "unknown";
        age: number;
        area: string;
        level: number;
        role: "owner" | "admin" | "member";
        title: string;
    };
    group: { group_id: number; group_name: string };
    reply?: (message: string | ICQQMessageElement[], quote?: boolean) => Promise<ICQQMessageRet>;
}
