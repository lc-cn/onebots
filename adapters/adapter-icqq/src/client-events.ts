import type {
    Client,
    DiscussMessageEvent,
    GroupMessageEvent,
    PrivateMessage,
    PrivateMessageEvent,
} from "@icqqjs/icqq";
import type { GuildMessageEvent } from "@icqqjs/icqq/lib/internal";
import { compileICQQReply } from "./messages.js";
import type { ICQQBotEvents } from "./bot-events.js";
import type {
    ICQQGroupMessageEvent,
    ICQQMessageElement,
    ICQQOfflineEvent,
    ICQQPrivateMessageEvent,
    ICQQUser,
} from "./types.js";
import type { ICQQDiscussMessageEvent, ICQQGuildMessageEvent } from "./extended-event-types.js";
import { encodeICQQGuildMessageId } from "./guild-message-id.js";

export interface ICQQClientEventSink {
    emit<K extends keyof ICQQBotEvents>(event: K, ...args: ICQQBotEvents[K]): void;
    online(user: ICQQUser): void;
    offline(): void;
}

/** ICQQ 声明未公开 EventEmitter 清理方法，运行时支持时安全释放旧代次监听器。 */
export function detachICQQClientListeners(client: Client): void {
    const candidate: unknown = client;
    if (
        candidate &&
        typeof candidate === "object" &&
        "removeAllListeners" in candidate &&
        typeof candidate.removeAllListeners === "function"
    ) {
        candidate.removeAllListeners();
    }
}

/**
 * 将 ICQQ 客户端的细粒度事件桥接为稳定的 Bot 事件。
 * 此层只处理客户端语义和原始数据保真，不投影 OneBots 通用事件。
 */
export function wireICQQClientEvents(client: Client, sink: ICQQClientEventSink): void {
    client.on("system.login.qrcode", event => sink.emit("qrcode", event));
    client.on("system.login.slider", event => sink.emit("slider", event));
    client.on("system.login.device", event => sink.emit("device", event));
    client.on("system.login.auth", event => sink.emit("auth", event));
    client.on("system.login.error", event => sink.emit("login_error", event));

    client.on("system.online", () => {
        const user = {
            user_id: client.uin,
            nickname: client.nickname,
            avatar: `https://q1.qlogo.cn/g?b=qq&nk=${client.uin}&s=640`,
        };
        sink.online(user);
        sink.emit("ready", user);
    });

    // ICQQ 会让 network / kickoff 冒泡到 system.offline，微任务标志避免重复通知。
    let offlineLeafHandled = false;
    const markLeafHandled = () => {
        offlineLeafHandled = true;
        sink.offline();
        queueMicrotask(() => {
            offlineLeafHandled = false;
        });
    };
    client.on("system.offline.network", event => {
        markLeafHandled();
        sink.emit("offline_network", projectOffline(client, event));
    });
    client.on("system.offline.kickoff", event => {
        markLeafHandled();
        sink.emit("offline", projectOffline(client, event));
    });
    client.on("system.offline", event => {
        if (offlineLeafHandled) return;
        sink.offline();
        sink.emit("offline", projectOffline(client, event));
    });

    client.on("message.private", event => {
        sink.emit("private_message", projectPrivateMessage(event));
    });
    client.on("message.group", event => {
        sink.emit("group_message", projectGroupMessage(event));
    });
    client.on("message.discuss", event => {
        sink.emit("discuss_message", projectDiscussMessage(event));
    });
    client.on("message.guild", event => {
        sink.emit("guild_message", projectGuildMessage(event));
    });
    client.on("sync.message", event => {
        sink.emit("synced_private_message", projectPrivateMessage(event));
    });
    client.on("request.friend", event => {
        sink.emit("friend_request", {
            raw_event: event,
            request_id: event.flag,
            user_id: event.user_id,
            nickname: event.nickname,
            comment: event.comment,
            source: event.source,
            sub_type: event.sub_type,
            age: event.age,
            sex: event.sex,
            time: event.time,
        });
    });
    client.on("request.group", event => {
        sink.emit("group_request", {
            raw_event: event,
            request_id: event.flag,
            group_id: event.group_id,
            user_id: event.user_id,
            nickname: event.nickname,
            sub_type: event.sub_type,
            comment: "comment" in event ? event.comment : "",
            group_name: event.group_name,
            inviter_id: "inviter_id" in event ? event.inviter_id : undefined,
            tips: "tips" in event ? event.tips : undefined,
            role: "role" in event ? event.role : undefined,
            time: event.time,
        });
    });

    client.on("notice.group.increase", event => {
        sink.emit("group_increase", {
            raw_event: event,
            group_id: event.group_id,
            user_id: event.user_id,
            nickname: event.nickname,
            operator_id: undefined,
            time: Date.now() / 1000,
        });
    });
    client.on("notice.group.decrease", event => {
        const subType =
            event.operator_id === event.user_id
                ? "leave"
                : event.user_id === client.uin
                  ? "kick_me"
                  : "kick";
        sink.emit("group_decrease", {
            raw_event: event,
            group_id: event.group_id,
            user_id: event.user_id,
            operator_id: event.operator_id,
            sub_type: subType,
            is_dismiss: event.dismiss,
            member: event.member,
            time: Date.now() / 1000,
        });
    });
    client.on("notice.group.ban", event => {
        sink.emit("group_mute", {
            raw_event: event,
            group_id: event.group_id,
            user_id: event.user_id,
            operator_id: event.operator_id,
            duration: event.duration,
            nickname: event.nickname,
            time: Date.now() / 1000,
        });
    });
    client.on("notice.group.admin", event => {
        sink.emit("group_admin", {
            raw_event: event,
            group_id: event.group_id,
            user_id: event.user_id,
            sub_type: event.set ? "set" : "unset",
            time: Date.now() / 1000,
        });
    });
    client.on("notice.group.reaction", event => {
        sink.emit("group_reaction", {
            raw_event: event,
            group_id: event.group_id,
            user_id: event.user_id,
            message_seq: event.seq,
            face_id: event.id,
            reaction_type: event.type === 1 ? "face" : "emoji",
            is_add: event.set,
            time: Date.now() / 1000,
        });
    });
    client.on("notice.friend.increase", event => {
        sink.emit("friend_change", {
            raw_event: event,
            change_type: "increase",
            user_id: event.user_id,
            nickname: event.nickname,
            time: nowSeconds(),
        });
    });
    client.on("notice.friend.decrease", event => {
        sink.emit("friend_change", {
            raw_event: event,
            change_type: "decrease",
            user_id: event.user_id,
            nickname: event.nickname,
            time: nowSeconds(),
        });
    });
    client.on("notice.group.sign", event => {
        sink.emit("group_sign", {
            raw_event: event,
            group_id: event.group_id,
            user_id: event.user_id,
            nickname: event.nickname,
            sign_text: event.sign_text,
            time: nowSeconds(),
        });
    });
    client.on("notice.group.transfer", event => {
        sink.emit("group_transfer", {
            raw_event: event,
            group_id: event.group_id,
            operator_id: event.operator_id,
            user_id: event.user_id,
            time: nowSeconds(),
        });
    });
    client.on("notice.friend.recall", event => {
        sink.emit("friend_recall", {
            raw_event: event,
            message_id: event.message_id,
            user_id: event.user_id,
            seq: event.seq,
            rand: event.rand,
            time: event.time,
        });
    });
    client.on("notice.group.recall", event => {
        sink.emit("group_recall", {
            raw_event: event,
            message_id: event.message_id,
            group_id: event.group_id,
            user_id: event.user_id,
            operator_id: event.operator_id,
            seq: event.seq,
            rand: event.rand,
            time: event.time,
        });
    });
    client.on("notice.friend.poke", event => {
        sink.emit("poke", {
            raw_event: event,
            operator_id: event.operator_id,
            target_id: event.target_id,
            action: event.action,
            suffix: event.suffix,
            time: Date.now() / 1000,
        });
    });
    client.on("notice.group.poke", event => {
        sink.emit("poke", {
            raw_event: event,
            group_id: event.group_id,
            operator_id: event.operator_id,
            target_id: event.target_id,
            action: event.action,
            suffix: event.suffix,
            time: Date.now() / 1000,
        });
    });
    client.on("sync.read.private", event => {
        sink.emit("read_sync", {
            raw_event: event,
            scene_type: "private",
            scene_id: event.user_id,
            cursor: event.time,
            time: nowSeconds(),
        });
    });
    client.on("sync.read.group", event => {
        sink.emit("read_sync", {
            raw_event: event,
            scene_type: "group",
            scene_id: event.group_id,
            cursor: event.seq,
            time: nowSeconds(),
        });
    });
    client.on("internal.input", event => {
        sink.emit("typing", {
            raw_event: event,
            user_id: event.user_id,
            end: event.end,
            time: nowSeconds(),
        });
    });
}

function projectOffline(client: Client, event?: { message?: string }): ICQQOfflineEvent {
    return { uin: client.uin, message: event?.message ?? "账号已离线" };
}

function projectPrivateMessage(
    event: PrivateMessage | PrivateMessageEvent,
): ICQQPrivateMessageEvent {
    return {
        raw_event: event,
        message_id: event.message_id,
        user_id: event.user_id,
        message: [...event.message],
        raw_message: event.raw_message,
        time: event.time,
        sender: {
            user_id: event.sender.user_id,
            user_uid: event.sender.user_uid,
            nickname: event.sender.nickname,
            group_id: event.sender.group_id,
            discuss_id: event.sender.discuss_id,
        },
        sub_type: event.sub_type,
        from_uid: event.from_uid,
        to_id: event.to_id,
        to_uid: event.to_uid,
        auto_reply: event.auto_reply,
        ...(typeof (event as Partial<PrivateMessageEvent>).reply === "function"
            ? {
                  reply: (message: string | ICQQMessageElement[], quote?: boolean) =>
                      (event as PrivateMessageEvent)
                          .reply(compileICQQReply(message), quote)
                          .then(result => ({
                              message_id: result.message_id,
                              seq: result.seq,
                              rand: result.rand,
                              time: result.time,
                          })),
              }
            : {}),
    };
}

function projectDiscussMessage(event: DiscussMessageEvent): ICQQDiscussMessageEvent {
    return {
        raw_event: event,
        message_id: event.message_id,
        discuss_id: event.discuss_id,
        discuss_name: event.discuss_name,
        user_id: event.user_id,
        message: [...event.message],
        raw_message: event.raw_message,
        time: event.time,
        sender: {
            user_id: event.sender.user_id,
            nickname: event.sender.nickname,
            card: event.sender.card,
        },
        atme: event.atme,
    };
}

function projectGuildMessage(event: GuildMessageEvent): ICQQGuildMessageEvent {
    const messageId = encodeICQQGuildMessageId({
        guild_id: event.guild_id,
        channel_id: event.channel_id,
        seq: event.seq,
        rand: event.rand,
        time: event.time,
    });
    return {
        raw_event: event,
        guild_id: event.guild_id,
        guild_name: event.guild_name,
        channel_id: event.channel_id,
        channel_name: event.channel_name,
        message_id: messageId,
        user_id: event.sender.tiny_id,
        message: [...event.message],
        raw_message: event.raw_message,
        time: event.time,
        is_delete: event.is_delete === true,
        sender: { user_id: event.sender.tiny_id, nickname: event.sender.nickname },
    };
}

function projectGroupMessage(event: GroupMessageEvent): ICQQGroupMessageEvent {
    return {
        raw_event: event,
        message_id: event.message_id,
        group_id: event.group_id,
        user_id: event.user_id,
        message: [...event.message],
        raw_message: event.raw_message,
        time: event.time,
        sender: {
            user_id: event.sender.user_id,
            user_uid: event.sender.user_uid,
            nickname: event.sender.nickname,
            sub_id: event.sender.sub_id,
            card: event.sender.card,
            sex: event.sender.sex,
            age: event.sender.age,
            area: event.sender.area,
            level: event.sender.level,
            role: event.sender.role,
            title: event.sender.title,
        },
        sub_type: event.sub_type,
        anonymous: event.anonymous,
        block: event.block,
        atall: event.atall,
        group: { group_id: event.group_id, group_name: event.group_name },
        atme: event.atme,
        reply: (message, quote) =>
            event.reply(compileICQQReply(message), quote).then(result => ({
                message_id: result.message_id,
                seq: result.seq,
                rand: result.rand,
                time: result.time,
            })),
    };
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}
