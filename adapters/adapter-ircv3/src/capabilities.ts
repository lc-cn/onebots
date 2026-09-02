import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    restrictAdapterEventCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { IRCV3_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { Ircv3Client } from "./client.js";
import type { Ircv3Config } from "./types.js";

const contextual = (note: string) => ({
    support: "native" as const,
    availability: "context" as const,
    note,
});

const platformActions = definePlatformActionCapabilities(IRCV3_PLATFORM_ACTIONS, action => {
    if (action === "send_irc_typing")
        return contextual("需要 message-tags 且 CLIENTTAGDENY 允许 typing");
    if (action === "get_irc_chathistory")
        return contextual("需要服务器通过 ISUPPORT 宣告 CHATHISTORY");
    if (action === "monitor_irc_targets") return contextual("需要服务器通过 ISUPPORT 宣告 MONITOR");
    if (action === "set_irc_realname") return contextual("需要协商 setname capability");
    if (["set_irc_mode", "kick_irc_member", "invite_irc_user", "set_irc_topic"].includes(action)) {
        return {
            support: "native",
            availability: "permission",
            permissions: ["目标 channel 的 IRC mode/oper 权限"],
        } as const;
    }
    return { support: "native" } as const;
});

/** Modern IRC 核心、稳定 IRCv3 扩展与 socket/manual 接入的静态能力上界。 */
export const ircv3Capabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["channel", "direct"] },
        get_message_history: contextual(
            "需要显式请求 WIP draft/chathistory，并协商 batch、message-tags、server-time 与 CHATHISTORY ISUPPORT",
        ),
        get_login_info: { support: "native" },
        get_user_info: { support: "native", note: "通过 WHOIS 获取服务器可提供的字段" },
        create_user_channel: {
            support: "emulated",
            note: "IRC 私聊以 nickname 作为 direct channel",
        },
        set_nickname: { support: "native" },
        get_group_list: { support: "native", note: "返回已加入和配置的 channels" },
        get_group_info: { support: "native" },
        leave_group: { support: "native" },
        get_group_member_list: {
            support: "native",
            note: "使用 NAMES 与 multi-prefix/userhost-in-names",
        },
        get_group_member_info: { support: "native", note: "通过 NAMES 验证频道成员与权限前缀" },
        kick_group_member: {
            support: "native",
            availability: "permission",
            permissions: ["channel operator 权限"],
        },
        invite_group_member: {
            support: "native",
            availability: "permission",
            permissions: ["目标 channel 的邀请权限"],
        },
        set_group_admin: {
            support: "native",
            availability: "permission",
            permissions: ["channel operator 权限"],
        },
        handle_group_request: contextual(
            "仅处理发送给当前机器人的 IRC INVITE；同意执行 JOIN，拒绝不发协议命令",
        ),
        send_group_announcement: { support: "native", note: "使用 IRC NOTICE" },
        get_channel_info: { support: "native" },
        get_channel_list: { support: "native" },
        can_send_image: { support: "native", note: "返回 false；IRC 无标准媒体上传" },
        can_send_record: { support: "native", note: "返回 false；IRC 无标准音频上传" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["channel", "direct"] },
        member_joined: { support: "native" },
        member_left: { support: "native" },
        user_updated: { support: "native", note: "NICK/ACCOUNT/AWAY/CHGHOST/SETNAME" },
        channel_updated: { support: "native", note: "TOPIC" },
        typing_started: contextual("需要 message-tags 与 +typing client tag"),
        typing_stopped: contextual("需要 message-tags 与 +typing client tag"),
        group_admin: { support: "native", note: "MODE +/-o" },
        group_ban: { support: "native", note: "MODE +/-b" },
        group_invitation: { support: "native", note: "INVITE" },
        custom: {
            support: "native",
            note: "ERROR 与未专门投影的稳定命令保留完整 raw_event/extensions.ircv3",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "emulated", direction: "send", note: "编译为 nickname 文本" },
        emoji: { support: "emulated", direction: "send", note: "编译为 Unicode/名称文本" },
        image: { support: "emulated", direction: "send", note: "仅编译公开 HTTP(S) URL" },
        video: { support: "emulated", direction: "send", note: "仅编译公开 HTTP(S) URL" },
        audio: { support: "emulated", direction: "send", note: "仅编译公开 HTTP(S) URL" },
        file: { support: "emulated", direction: "send", note: "仅编译公开 HTTP(S) URL" },
        reply: { ...contextual("发送需 message-tags + msgid；接收保留 +reply"), direction: "both" },
    },
    transports: {
        tcp_tls: {
            support: "native",
            mode: "native",
            note: "默认 TLS，AbortSignal 与无限指数退避重连",
        },
        existing_socket: {
            support: "native",
            mode: "native",
            note: "acceptSocket() 接受宿主已有 TCP/TLS/WebSocket bridge",
        },
        manual: {
            support: "native",
            mode: "native",
            note: "ingest(rawEvent) 复用严格解析、状态更新、过滤与 canonical 投影",
        },
    },
});

const eventSources: Readonly<Record<string, readonly string[]>> = {
    message: ["PRIVMSG", "NOTICE"],
    member_joined: ["JOIN"],
    member_left: ["PART", "QUIT", "KICK"],
    user_updated: ["NICK", "ACCOUNT", "AWAY", "CHGHOST", "SETNAME"],
    channel_updated: ["TOPIC"],
    typing_started: ["TAGMSG"],
    typing_stopped: ["TAGMSG"],
    group_admin: ["MODE"],
    group_ban: ["MODE"],
    group_invitation: ["INVITE"],
    custom: ["ERROR"],
};

export function describeIrcv3Capabilities(
    config: Pick<Ircv3Config, "event_commands">,
    client?: Ircv3Client,
): AdapterCapabilityManifest {
    const commands = new Set((config.event_commands || []).map(command => command.toUpperCase()));
    const available = new Set<string>();
    for (const [event, sources] of Object.entries(eventSources)) {
        if (sources.some(source => commands.has(source))) available.add(event);
    }
    let manifest = restrictAdapterEventCapabilities(
        ircv3Capabilities,
        available,
        event => `event_commands 未包含可生成 ${event} 的 IRC command`,
    );
    if (!client) return manifest;
    const actions = { ...manifest.actions };
    const events = { ...manifest.events };
    const segments = { ...manifest.segments };
    if (!client.supportsHistory())
        actions.get_message_history = unavailable(
            "未完整协商 draft/chathistory、batch、message-tags、server-time 或 CHATHISTORY ISUPPORT",
        );
    if (!client.supportsHistory())
        actions.get_irc_chathistory = unavailable(
            "未完整协商 draft/chathistory、batch、message-tags、server-time 或 CHATHISTORY ISUPPORT",
        );
    if (!client.supportsFeature("MONITOR"))
        actions.monitor_irc_targets = unavailable("服务器未宣告 MONITOR ISUPPORT");
    if (!client.supportsCapability("setname"))
        actions.set_irc_realname = unavailable("当前连接未协商 setname");
    if (!client.supportsClientTag("typing"))
        actions.send_irc_typing = unavailable(
            "当前连接未协商 message-tags，或 CLIENTTAGDENY 禁止 typing",
        );
    if (!client.supportsCapability("message-tags")) {
        events.typing_started = unavailable("当前连接未协商 message-tags");
        events.typing_stopped = unavailable("当前连接未协商 message-tags");
        segments.reply = {
            ...unavailable("当前连接未协商 message-tags"),
            direction: "both",
        };
    }
    manifest = defineAdapterCapabilities({
        actions,
        events,
        segments,
        transports: manifest.transports,
    });
    return manifest;
}

function unavailable(note: string) {
    return { support: "unsupported" as const, availability: "context" as const, note };
}
