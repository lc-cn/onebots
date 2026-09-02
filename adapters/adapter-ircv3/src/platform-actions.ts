import { Ircv3Error } from "./errors.js";
import { splitIrcv3ActionText, splitIrcv3Text } from "./messages.js";
import type { Ircv3Client } from "./client.js";

export const IRCV3_PLATFORM_ACTIONS = new Set([
    "join_irc_channel",
    "part_irc_channel",
    "send_irc_notice",
    "send_irc_action",
    "set_irc_topic",
    "set_irc_mode",
    "kick_irc_member",
    "invite_irc_user",
    "whois_irc_user",
    "names_irc_channel",
    "monitor_irc_targets",
    "set_irc_away",
    "set_irc_realname",
    "send_irc_typing",
    "get_irc_chathistory",
    "get_irc_session",
    "call_irc_command",
] as const);

export type Ircv3PlatformAction = (typeof IRCV3_PLATFORM_ACTIONS extends Set<infer T> ? T : never) &
    string;

const SAFE_COMMANDS = new Set([
    "AWAY",
    "HELP",
    "INFO",
    "INVITE",
    "ISON",
    "JOIN",
    "KICK",
    "LIST",
    "LUSERS",
    "MODE",
    "MONITOR",
    "MOTD",
    "NAMES",
    "NOTICE",
    "PART",
    "PING",
    "PRIVMSG",
    "SETNAME",
    "STATS",
    "TAGMSG",
    "TIME",
    "TOPIC",
    "USERHOST",
    "VERSION",
    "WHO",
    "WHOIS",
    "WHOWAS",
]);

export async function executeIrcv3PlatformAction(
    client: Ircv3Client,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    switch (action as Ircv3PlatformAction) {
        case "join_irc_channel":
            return client.join(text(params, "channel"), optionalText(params, "key"));
        case "part_irc_channel":
            return client.part(text(params, "channel"), optionalText(params, "reason"));
        case "send_irc_notice":
            return sendSplitText(client, "NOTICE", text(params, "target"), text(params, "text"));
        case "send_irc_action": {
            const target = text(params, "target");
            return sendLines(
                client,
                "PRIVMSG",
                target,
                splitIrcv3ActionText(target, text(params, "text")),
            );
        }
        case "set_irc_topic":
            return client.call("TOPIC", [text(params, "channel"), text(params, "topic")]);
        case "set_irc_mode":
            return client.call("MODE", [
                text(params, "target"),
                text(params, "modes"),
                ...stringArray(params, "arguments", false),
            ]);
        case "kick_irc_member": {
            const reason = optionalText(params, "reason");
            return client.call(
                "KICK",
                reason
                    ? [text(params, "channel"), text(params, "nickname"), reason]
                    : [text(params, "channel"), text(params, "nickname")],
            );
        }
        case "invite_irc_user":
            return client.call("INVITE", [text(params, "nickname"), text(params, "channel")]);
        case "whois_irc_user":
            return client.whois(text(params, "nickname"));
        case "names_irc_channel":
            return client.names(text(params, "channel"));
        case "monitor_irc_targets": {
            if (!client.supportsFeature("MONITOR")) throw unavailable("MONITOR");
            const operation = optionalText(params, "operation") || "+";
            if (!["+", "-", "C", "L", "S"].includes(operation))
                throw Ircv3Error.invalid("MONITOR operation 无效");
            const targets = stringArray(params, "targets", operation === "+" || operation === "-");
            return client.call(
                "MONITOR",
                targets.length ? [operation, targets.join(",")] : [operation],
            );
        }
        case "set_irc_away": {
            const message = optionalText(params, "message");
            return client.call("AWAY", message === undefined ? [] : [message]);
        }
        case "set_irc_realname":
            if (!client.supportsCapability("setname")) throw unavailable("setname");
            return client.call("SETNAME", [text(params, "realname")]);
        case "send_irc_typing":
            return client.sendTyping(
                text(params, "target"),
                oneOf(params, "state", ["active", "paused", "done"]),
            );
        case "get_irc_chathistory":
            return client.history(
                text(params, "target"),
                integer(params, "limit", 1, 10_000),
                optionalText(params, "before_message_id"),
            );
        case "get_irc_session":
            return client.snapshot;
        case "call_irc_command": {
            const command = text(params, "command").toUpperCase();
            if (!SAFE_COMMANDS.has(command)) {
                throw new Ircv3Error(
                    `网关动作不允许发送生命周期或凭据命令 ${command}；嵌入式 Client 可直接调用 call()`,
                    {
                        code: "IRCV3_COMMAND_NOT_ALLOWED",
                        command,
                    },
                );
            }
            return client.call(command, stringArray(params, "params", false), {
                tags: tagRecord(params.tags),
            });
        }
        default:
            throw new Ircv3Error(`未知 IRCv3 平台动作: ${action}`, {
                code: "IRCV3_UNKNOWN_ACTION",
            });
    }
}

async function sendSplitText(
    client: Ircv3Client,
    command: "PRIVMSG" | "NOTICE",
    target: string,
    value: string,
): Promise<void> {
    return sendLines(client, command, target, splitIrcv3Text(command, target, value));
}

async function sendLines(
    client: Ircv3Client,
    command: "PRIVMSG" | "NOTICE",
    target: string,
    lines: readonly string[],
): Promise<void> {
    for (const line of lines) await client.call(command, [target, line]);
}

function text(params: Readonly<Record<string, unknown>>, key: string): string {
    const value = params[key];
    if (typeof value !== "string" || !value || /[\0\r\n]/u.test(value))
        throw Ircv3Error.invalid(`${key} 必须是非空安全字符串`);
    return value;
}

function optionalText(params: Readonly<Record<string, unknown>>, key: string): string | undefined {
    const value = params[key];
    if (value === undefined) return undefined;
    return text(params, key);
}

function stringArray(
    params: Readonly<Record<string, unknown>>,
    key: string,
    required: boolean,
): string[] {
    const value = params[key];
    if (value === undefined && !required) return [];
    if (
        !Array.isArray(value) ||
        (required && value.length === 0) ||
        value.some(item => typeof item !== "string" || !item || /[\0\r\n]/u.test(item))
    ) {
        throw Ircv3Error.invalid(`${key} 必须是${required ? "非空" : ""}安全字符串数组`);
    }
    return [...value] as string[];
}

function integer(
    params: Readonly<Record<string, unknown>>,
    key: string,
    min: number,
    max: number,
): number {
    const value = params[key];
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
        throw Ircv3Error.invalid(`${key} 必须是 ${min}-${max} 的安全整数`);
    return value as number;
}

function oneOf<const T extends string>(
    params: Readonly<Record<string, unknown>>,
    key: string,
    values: readonly T[],
): T {
    const value = text(params, key);
    if (!values.includes(value as T)) throw Ircv3Error.invalid(`${key} 必须是 ${values.join("/")}`);
    return value as T;
}

function tagRecord(value: unknown): Record<string, string | null> | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw Ircv3Error.invalid("tags 必须是对象");
    const tags: Record<string, string | null> = Object.create(null) as Record<
        string,
        string | null
    >;
    for (const [key, item] of Object.entries(value)) {
        if (item !== null && typeof item !== "string")
            throw Ircv3Error.invalid(`tags.${key} 必须是字符串或 null`);
        tags[key] = item;
    }
    return tags;
}

function unavailable(feature: string): Ircv3Error {
    return new Ircv3Error(`当前 IRC server 未宣告 ${feature}`, {
        code: "IRCV3_FEATURE_UNAVAILABLE",
    });
}
