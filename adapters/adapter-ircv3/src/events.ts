import type { CommonEvent, CommonTypes } from "onebots";
import { projectIrcv3MessageSegments } from "./messages.js";
import type { Ircv3Delivery, Ircv3Message, Ircv3SessionSnapshot } from "./types.js";

export interface Ircv3ProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
    snapshot: Ircv3SessionSnapshot;
}

/** 把稳定 IRC/IRCv3 命令投影为 canonical 事件，原始 message 始终无损保留。 */
export function projectIrcv3Event(
    delivery: Ircv3Delivery,
    context: Ircv3ProjectionContext,
): CommonEvent.Event<Ircv3Message>[] {
    const command = delivery.message.command;
    if (command === "PRIVMSG" || command === "NOTICE") return [projectMessage(delivery, context)];
    if (command === "INVITE") return [projectInvite(delivery, context)];
    if (command === "TAGMSG") return [projectTagMessage(delivery, context)];
    if (command === "JOIN") return [membership(delivery, context, "member_joined")];
    if (["PART", "QUIT", "KICK"].includes(command))
        return [membership(delivery, context, "member_left")];
    if (["NICK", "ACCOUNT", "AWAY", "CHGHOST", "SETNAME"].includes(command)) {
        return [notice(delivery, context, "user_updated")];
    }
    if (command === "TOPIC") return [topicNotice(delivery, context)];
    if (command === "MODE") return modeNotices(delivery, context);
    return [notice(delivery, context, "custom")];
}

function projectMessage(
    delivery: Ircv3Delivery,
    context: Ircv3ProjectionContext,
): CommonEvent.Message<Ircv3Message> {
    const { message } = delivery;
    const target = message.params[0] || context.snapshot.nickname;
    const text = message.params[1] || "";
    const channel = isChannel(target, context.snapshot);
    return {
        ...base(delivery, context),
        type: "message",
        message_type: channel ? "channel" : "direct",
        sender: user(message, context),
        group: channel ? group(target, context) : undefined,
        message_id: context.createId(
            typeof message.tags.msgid === "string" ? message.tags.msgid : delivery.id,
        ),
        message: projectIrcv3MessageSegments(text, message.tags),
        raw_message: text,
        extensions: {
            ircv3: {
                command: message.command,
                tags: message.tags,
                source: message.source,
                target,
                batch: delivery.batch,
                replayed: delivery.replayed,
                action: /^\u0001ACTION [\s\S]*\u0001$/u.test(text),
            },
        },
    };
}

function projectInvite(
    delivery: Ircv3Delivery,
    context: Ircv3ProjectionContext,
): CommonEvent.Request<Ircv3Message> {
    const channel = delivery.message.params[1] || delivery.message.params[0] || "unknown";
    return {
        ...base(delivery, context),
        type: "request",
        request_type: "group",
        sub_type: "invite",
        user: user(delivery.message, context),
        group: group(channel, context),
        comment: `邀请 ${context.snapshot.nickname} 加入 ${channel}`,
        flag: delivery.id,
        extensions: extension(delivery),
    };
}

function projectTagMessage(
    delivery: Ircv3Delivery,
    context: Ircv3ProjectionContext,
): CommonEvent.Notice<Ircv3Message> {
    const typing = delivery.message.tags["+typing"];
    return notice(
        delivery,
        context,
        typing === "active" || typing === "paused"
            ? "typing_started"
            : typing === "done"
              ? "typing_stopped"
              : "custom",
    );
}

function membership(
    delivery: Ircv3Delivery,
    context: Ircv3ProjectionContext,
    noticeType: "member_joined" | "member_left",
): CommonEvent.Notice<Ircv3Message> {
    const { message } = delivery;
    const channel =
        message.command === "KICK"
            ? message.params[0]
            : message.command === "QUIT"
              ? undefined
              : message.params[0];
    const targetNick = message.command === "KICK" ? message.params[1] : message.source?.nick;
    return {
        ...base(delivery, context),
        type: "notice",
        notice_type: noticeType,
        sub_type: message.command.toLowerCase(),
        user:
            message.command === "KICK" && targetNick
                ? { id: context.createId(targetNick), name: targetNick }
                : user(message, context),
        operator: message.command === "KICK" ? user(message, context) : undefined,
        group: channel ? group(channel, context) : undefined,
        extensions: extension(delivery),
    };
}

function topicNotice(
    delivery: Ircv3Delivery,
    context: Ircv3ProjectionContext,
): CommonEvent.Notice<Ircv3Message> {
    const channel = delivery.message.params[0] || "unknown";
    return {
        ...notice(delivery, context, "channel_updated"),
        group: group(channel, context),
        resource: {
            type: "topic",
            id: context.createId(channel),
            name: delivery.message.params[1],
        },
    };
}

function modeNotices(
    delivery: Ircv3Delivery,
    context: Ircv3ProjectionContext,
): CommonEvent.Notice<Ircv3Message>[] {
    const changes = parseModeChanges(delivery.message, context.snapshot).filter(change =>
        ["o", "b"].includes(change.mode),
    );
    if (changes.length === 0) return [notice(delivery, context, "custom")];
    return changes.map(change => {
        const projected = notice(
            delivery,
            context,
            change.mode === "o" ? "group_admin" : "group_ban",
        );
        return {
            ...projected,
            sub_type: `${change.adding ? "set" : "unset"}_${change.mode === "o" ? "operator" : "ban"}`,
            user: change.argument
                ? { id: context.createId(change.argument), name: change.argument }
                : projected.user,
            operator: delivery.message.source ? user(delivery.message, context) : undefined,
        };
    });
}

interface ModeChange {
    mode: string;
    adding: boolean;
    argument?: string;
}

function parseModeChanges(message: Ircv3Message, snapshot: Ircv3SessionSnapshot): ModeChange[] {
    const modes = message.params[1] || "";
    const parameters = message.params.slice(2);
    const changes: ModeChange[] = [];
    let adding = true;
    let parameterIndex = 0;
    for (const mode of modes) {
        if (mode === "+" || mode === "-") {
            adding = mode === "+";
            continue;
        }
        const takesArgument = modeTakesArgument(mode, adding, snapshot);
        changes.push({
            mode,
            adding,
            argument: takesArgument ? parameters[parameterIndex++] : undefined,
        });
    }
    return changes;
}

function modeTakesArgument(mode: string, adding: boolean, snapshot: Ircv3SessionSnapshot): boolean {
    const prefixModes = /^\(([^)]*)\)/u.exec(snapshot.isupport.PREFIX || "")?.[1] || "ov";
    if (prefixModes.includes(mode)) return true;
    const [alwaysList = "beI", alwaysValue = "k", whenSet = "l"] = (
        snapshot.isupport.CHANMODES || "beI,k,l,imnst"
    ).split(",");
    return (
        alwaysList.includes(mode) ||
        alwaysValue.includes(mode) ||
        (adding && whenSet.includes(mode))
    );
}

function notice(
    delivery: Ircv3Delivery,
    context: Ircv3ProjectionContext,
    noticeType: CommonEvent.Notice["notice_type"],
): CommonEvent.Notice<Ircv3Message> {
    const channel = delivery.message.params.find(param => isChannel(param, context.snapshot));
    return {
        ...base(delivery, context),
        type: "notice",
        notice_type: noticeType,
        sub_type: delivery.message.command.toLowerCase(),
        user: delivery.message.source ? user(delivery.message, context) : undefined,
        group: channel ? group(channel, context) : undefined,
        extensions: extension(delivery),
    };
}

function base(
    delivery: Ircv3Delivery,
    context: Ircv3ProjectionContext,
): CommonEvent.Base<Ircv3Message> {
    return {
        id: context.createId(delivery.id),
        timestamp: delivery.receivedAt,
        type: delivery.message.command.toLowerCase(),
        platform: "ircv3",
        bot_id: context.botId,
        raw_event: delivery.message,
    };
}

function user(message: Ircv3Message, context: Ircv3ProjectionContext): CommonTypes.User {
    const taggedAccount =
        typeof message.tags.account === "string" && message.tags.account !== "*"
            ? message.tags.account
            : undefined;
    const joinedAccount =
        message.command === "JOIN" && message.params[1] && message.params[1] !== "*"
            ? message.params[1]
            : undefined;
    const account = taggedAccount || joinedAccount;
    const nick = message.source?.nick || message.source?.raw || "unknown";
    return {
        id: context.createId(account || nick),
        name: nick,
        account,
        username: message.source?.user,
        hostname: message.source?.host,
        realname:
            message.command === "JOIN"
                ? message.params[2]
                : message.command === "SETNAME"
                  ? message.params[0]
                  : undefined,
    };
}

function group(channel: string, context: Ircv3ProjectionContext): CommonTypes.Group {
    const id = context.createId(channel);
    return { id, name: channel, channel_id: id };
}

function isChannel(target: string, snapshot: Ircv3SessionSnapshot): boolean {
    const chantypes = snapshot.isupport.CHANTYPES || "#&";
    return Boolean(target && chantypes.includes(target[0]));
}

function extension(delivery: Ircv3Delivery): Record<string, unknown> {
    return {
        ircv3: {
            command: delivery.message.command,
            params: delivery.message.params,
            tags: delivery.message.tags,
            source: delivery.message.source,
            batch: delivery.batch,
            replayed: delivery.replayed,
        },
    };
}
