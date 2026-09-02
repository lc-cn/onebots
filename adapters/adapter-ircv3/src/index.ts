import { AdapterRegistry, type Schema } from "onebots";
import { Ircv3Adapter } from "./adapter.js";
import { ircv3Capabilities } from "./capabilities.js";
import { IRCV3_EVENT_COMMANDS, IRCV3_STABLE_CAPABILITIES } from "./configuration.js";
import type { Ircv3Config } from "./types.js";

export { Ircv3Adapter };
export { Ircv3Client } from "./client.js";
export {
    IRC_CLIENT_TAG_DATA_MAX_BYTES,
    IRC_DEFAULT_MAX_LINE_BYTES,
    IRC_MAIN_SECTION_MAX_BYTES,
    IRC_TAG_SECTION_MAX_BYTES,
    Ircv3LineDecoder,
    coerceIrcv3Message,
    formatIrcv3Message,
    parseIrcv3Message,
} from "./codec.js";
export { describeIrcv3Capabilities, ircv3Capabilities } from "./capabilities.js";
export {
    assertIrcv3Config,
    IRCV3_EVENT_COMMANDS,
    IRCV3_STABLE_CAPABILITIES,
    normalizeIrcv3Config,
    type NormalizedIrcv3Config,
} from "./configuration.js";
export { Ircv3Error, type Ircv3ErrorOptions } from "./errors.js";
export { projectIrcv3Event, type Ircv3ProjectionContext } from "./events.js";
export {
    compileIrcv3Message,
    projectIrcv3MessageSegments,
    splitIrcv3ActionText,
    splitIrcv3Text,
    type CompiledIrcv3Message,
} from "./messages.js";
export {
    executeIrcv3PlatformAction,
    IRCV3_PLATFORM_ACTIONS,
    type Ircv3PlatformAction,
} from "./platform-actions.js";
export {
    assertIrcv3SocketAttachment,
    connectIrcv3Socket,
    defaultIrcv3Servername,
    Ircv3SocketBinding,
} from "./transport.js";
export type {
    Ircv3ChannelConfig,
    Ircv3ClientDependencies,
    Ircv3ClientEvents,
    Ircv3CommandOptions,
    Ircv3Config,
    Ircv3ConnectOptions,
    Ircv3Delivery,
    Ircv3IngestResult,
    Ircv3Message,
    Ircv3Prefix,
    Ircv3ReceiveMode,
    Ircv3RequestOptions,
    Ircv3SaslMechanism,
    Ircv3SessionSnapshot,
    Ircv3Socket,
    Ircv3SocketAttachOptions,
} from "./types.js";

const eventLabels: Readonly<Record<string, string>> = {
    PRIVMSG: "聊天消息（含 CTCP ACTION）",
    NOTICE: "Notice 消息",
    TAGMSG: "IRCv3 client tags（含 typing）",
    JOIN: "加入频道",
    PART: "离开频道",
    KICK: "成员被移出",
    QUIT: "用户离线",
    NICK: "昵称变化",
    INVITE: "频道邀请",
    TOPIC: "频道主题变化",
    MODE: "模式/权限变化",
    ACCOUNT: "账号登录状态变化",
    AWAY: "离开状态变化",
    CHGHOST: "user/host 变化",
    SETNAME: "realname 变化",
    ERROR: "服务器错误",
};

export const ircv3Schema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内区分 IRC network/bot 的稳定标识，不随 nickname 改变",
        ui: { section: "credentials" },
    },
    receive_mode: {
        type: "string",
        default: "connection",
        label: "事件接收方式",
        choices: [
            { value: "connection", label: "主动 TCP/TLS 连接" },
            { value: "manual", label: "已有 socket / ingest(rawEvent)" },
        ],
        description: "manual 不会新开端口或主动连接；宿主将已有连接或消息交给同一 Client",
        ui: { section: "transport" },
    },
    host: {
        type: "string",
        label: "IRC Server",
        placeholder: "irc.libera.chat",
        description: "只填主机名或 IP，不含 ircs://、端口和路径",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["connection"] },
        },
    },
    port: {
        type: "number",
        min: 1,
        max: 65535,
        label: "端口",
        placeholder: "TLS 默认 6697；明文默认 6667",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["connection"] },
        },
    },
    tls: {
        type: "boolean",
        default: true,
        label: "启用 TLS",
        description: "生产连接应保持启用",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["connection"] },
        },
    },
    tls_servername: {
        type: "string",
        label: "TLS Server Name",
        description: "留空使用 host；仅在证书名称与连接地址不同时覆盖",
        ui: {
            section: "advanced",
            visibleWhen: { path: "receive_mode", oneOf: ["connection"] },
        },
    },
    tls_reject_unauthorized: {
        type: "boolean",
        default: true,
        label: "校验 TLS 证书",
        description: "关闭会失去服务器身份校验，只应在受控测试网络使用",
        ui: {
            section: "advanced",
            visibleWhen: { path: "receive_mode", oneOf: ["connection"] },
        },
    },
    tls_client_cert_path: {
        type: "string",
        label: "TLS Client Certificate Path",
        description: "SASL EXTERNAL 或双向 TLS 使用的 PEM certificate 文件路径",
        ui: {
            section: "advanced",
            visibleWhen: { path: "receive_mode", oneOf: ["connection"] },
        },
    },
    tls_client_key_path: {
        type: "string",
        label: "TLS Client Private Key Path",
        description: "必须与 client certificate 同时配置",
        ui: {
            section: "advanced",
            visibleWhen: { path: "receive_mode", oneOf: ["connection"] },
        },
    },
    tls_client_key_passphrase: {
        type: "string",
        sensitive: true,
        label: "TLS Client Key Passphrase",
        ui: {
            section: "advanced",
            visibleWhen: { path: "receive_mode", oneOf: ["connection"] },
        },
    },
    nickname: {
        type: "string",
        required: true,
        label: "Bot Nickname",
        placeholder: "onebots",
        ui: { section: "credentials" },
    },
    username: {
        type: "string",
        label: "Username / ident",
        description: "留空使用 nickname",
        ui: { section: "credentials" },
    },
    realname: {
        type: "string",
        label: "Realname (GECOS)",
        default: "OneBots IRCv3",
        ui: { section: "credentials" },
    },
    server_password: {
        type: "string",
        sensitive: true,
        label: "Server Password",
        description: "仅用于注册前 PASS；不是 NickServ 密码",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["connection"] },
        },
    },
    sasl_mechanism: {
        type: "string",
        label: "SASL 机制",
        choices: [
            { value: "PLAIN", label: "PLAIN（TLS 内账号密码）" },
            { value: "EXTERNAL", label: "EXTERNAL（外部证书身份）" },
        ],
        description: "留空不使用 SASL；只实现 IRCv3 稳定且明确支持的机制",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["connection"] },
        },
    },
    sasl_username: {
        type: "string",
        label: "SASL Username",
        ui: { section: "credentials", visibleWhen: { path: "sasl_mechanism", oneOf: ["PLAIN"] } },
    },
    sasl_password: {
        type: "string",
        sensitive: true,
        label: "SASL Password",
        ui: { section: "credentials", visibleWhen: { path: "sasl_mechanism", oneOf: ["PLAIN"] } },
    },
    sasl_authzid: {
        type: "string",
        label: "SASL Authorization ID",
        description: "通常留空；PLAIN/EXTERNAL 需要独立 authzid 时填写",
        ui: {
            section: "advanced",
            visibleWhen: { path: "sasl_mechanism", oneOf: ["PLAIN", "EXTERNAL"] },
        },
    },
    sasl_required: {
        type: "boolean",
        default: false,
        label: "SASL 必须成功",
        description: "启用后，服务器不支持或拒绝 SASL 时中止注册，不降级为匿名身份",
        ui: {
            section: "credentials",
            visibleWhen: { path: "sasl_mechanism", oneOf: ["PLAIN", "EXTERNAL"] },
        },
    },
    channels: {
        type: "array",
        default: [],
        label: "频道",
        description: "逐项添加自动加入的 channel；无需手写 JSON",
        ui: {
            section: "delivery",
            widget: "record-list",
            itemLabel: "频道",
            addLabel: "添加频道",
            fields: [
                { key: "name", label: "频道名", placeholder: "#onebots" },
                {
                    key: "key",
                    label: "频道 Key",
                    sensitive: true,
                    description: "仅受 key 保护的频道需要",
                },
                { key: "auto_join", label: "连接后自动加入", type: "boolean" },
            ],
        },
    },
    requested_capabilities: {
        type: "array",
        default: [...IRCV3_STABLE_CAPABILITIES],
        label: "请求的 IRCv3 Capabilities",
        choices: IRCV3_STABLE_CAPABILITIES.map(value => ({ value, label: value })),
        allowCustomValues: true,
        description: "默认只含 IRCv3 已稳定能力；可添加网络 vendor capability，draft 不会自动启用",
        ui: {
            section: "delivery",
            widget: "choice-list",
            itemLabel: "Capability",
            addLabel: "添加 Capability",
        },
    },
    event_commands: {
        type: "array",
        default: [...IRCV3_EVENT_COMMANDS],
        label: "接收事件命令",
        choices: IRCV3_EVENT_COMMANDS.map(value => ({ value, label: eventLabels[value] || value })),
        description:
            "动态增减需要投影的 IRC command；PING/CAP/数值回复仍用于内部会话但不产生业务事件",
        ui: {
            section: "filter",
            widget: "choice-list",
            itemLabel: "IRC command",
            addLabel: "添加事件命令",
        },
    },
    reconnect_initial_delay_ms: {
        type: "number",
        default: 1000,
        min: 100,
        max: 300000,
        label: "重连初始延迟（ms）",
        ui: { section: "advanced", visibleWhen: { path: "receive_mode", oneOf: ["connection"] } },
    },
    reconnect_max_delay_ms: {
        type: "number",
        default: 60000,
        min: 100,
        max: 3600000,
        label: "重连最大延迟（ms）",
        description: "连接次数不设上限；延迟在此上限内带 jitter 退避",
        ui: { section: "advanced", visibleWhen: { path: "receive_mode", oneOf: ["connection"] } },
    },
    connect_timeout_ms: {
        type: "number",
        default: 15000,
        min: 100,
        max: 300000,
        label: "连接/注册超时（ms）",
        ui: { section: "advanced" },
    },
    command_timeout_ms: {
        type: "number",
        default: 15000,
        min: 100,
        max: 300000,
        label: "命令响应超时（ms）",
        ui: { section: "advanced" },
    },
    max_line_bytes: {
        type: "number",
        default: 8703,
        min: 512,
        max: 8703,
        label: "入站单行上限（bytes）",
        description: "512-byte 主报文加 IRCv3 message-tags 最大扩展；防止无界缓冲",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("ircv3", ircv3Schema);

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            ircv3: Ircv3Config;
        }
    }
}

AdapterRegistry.register("ircv3", Ircv3Adapter, {
    name: "ircv3",
    displayName: "IRCv3",
    description: "Modern IRC、IRCv3 CAP 302、TLS/SASL、已有 socket 与 manual ingress 适配器",
    icon: "https://ircv3.net/favicon.ico",
    homepage: "https://ircv3.net/irc/",
    author: "凉菜",
    capabilities: ircv3Capabilities,
});
