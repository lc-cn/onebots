export type ExtensionType = "adapter" | "protocol";

export interface ExtensionSetupStep {
    title: string;
    description: string;
    url?: string;
}

export type ExtensionConfigurationTarget =
    | { kind: "account"; platform: string }
    | { kind: "protocol"; protocolKey: string };

export interface ExtensionCatalogEntry {
    id: string;
    type: ExtensionType;
    name: string;
    displayName: string;
    description: string;
    packageName: string;
    configurationTarget: ExtensionConfigurationTarget;
    setup: ExtensionSetupStep[];
}

const adapter = (
    name: string,
    displayName: string,
    description: string,
    setup: ExtensionSetupStep[] = [],
): ExtensionCatalogEntry => ({
    id: `adapter:${name}`,
    type: "adapter",
    name,
    displayName,
    description,
    packageName: `@onebots/adapter-${name}`,
    configurationTarget: { kind: "account", platform: name },
    setup,
});

const protocol = (
    name: string,
    protocolKey: string,
    displayName: string,
    description: string,
): ExtensionCatalogEntry => ({
    id: `protocol:${name}`,
    type: "protocol",
    name,
    displayName,
    description,
    packageName: `@onebots/protocol-${name}`,
    configurationTarget: { kind: "protocol", protocolKey },
    setup: [
        {
            title: "配置协议出口",
            description: "安装并重启后，在配置管理中为账号启用该协议并设置监听方式。",
        },
    ],
});

const genericSetup: ExtensionSetupStep[] = [
    {
        title: "准备平台应用",
        description: "前往平台开发者后台创建机器人或应用，并准备页面要求的凭据。",
    },
    {
        title: "填写账号配置",
        description: "安装并重启后点击“去配置”，表单会根据适配器 Schema 标出必填项。",
    },
    {
        title: "保存并应用",
        description: "保存后 OneBots 会校验配置并自动热重载账号。",
    },
];

export const EXTENSION_CATALOG: readonly ExtensionCatalogEntry[] = [
    adapter(
        "instagram",
        "Instagram Messaging",
        "连接 Instagram Login、Messaging、Graph API、Webhook 与已有事件入口。",
        [
            {
                title: "创建 Meta App 与 Instagram 身份",
                description:
                    "启用 Business Login for Instagram，准备 Professional Account ID、Instagram User Access Token、App Secret 与 Verify Token。",
                url: "https://www.postman.com/meta/instagram/overview",
            },
            {
                title: "选择 Webhook 或已有入口",
                description:
                    "Webhook 使用公开 HTTPS callback 并保留精确 raw body；已有 Host、队列或 consumer 选择 manual。",
            },
            {
                title: "配置订阅和权限",
                description:
                    "Web 表单可动态增减 webhook fields、事件与当前 permissions，并实时收敛账号能力。",
            },
            {
                title: "核对平台限制",
                description:
                    "Instagram Messaging 仅支持 direct；Human Agent 与评论私信分别遵守审核、用途和消息窗口限制。",
            },
        ],
    ),
    adapter(
        "facebook-messenger",
        "Facebook Messenger",
        "连接 Messenger Platform、Graph API、Webhook 与已有事件入口。",
        [
            {
                title: "创建 Meta App 与 Page 身份",
                description:
                    "为目标 Facebook Page 启用 Messenger，准备 Page ID、Page Access Token、App Secret 与自定义 Verify Token。",
                url: "https://www.postman.com/meta/messenger-platform-api/overview",
            },
            {
                title: "配置 Webhook 或已有入口",
                description:
                    "Webhook 使用公开 HTTPS callback 并保留精确 raw body；已有 Host、队列或 consumer 选择 manual。",
            },
            {
                title: "选择订阅字段和事件",
                description:
                    "安装并重启后，Web 表单可动态增减 webhook fields、canonical 事件和已授权 permissions。",
            },
            {
                title: "授权并核对账号能力",
                description:
                    "按实际动作授予 Page permissions；Utility Messaging 另需 page_utility_messaging，并受地区和模板规则约束。",
            },
        ],
    ),
    adapter(
        "google-chat",
        "Google Chat",
        "连接 Google Chat REST v1、Interaction HTTPS 与 Workspace Events。",
        [
            {
                title: "创建并配置 Chat 应用",
                description:
                    "在 Google Cloud 启用 Chat API，配置应用身份与 service account；用户身份则准备已有 OAuth token。",
                url: "https://developers.google.com/workspace/chat/quickstart/gcloud",
            },
            {
                title: "选择事件入口",
                description:
                    "Interaction 使用 Chat HTTPS endpoint；资源事件使用 Workspace Events + authenticated Pub/Sub push；已有 Host 使用 manual。",
            },
            {
                title: "填写凭据、Audience 与事件",
                description:
                    "安装并重启后，Web 表单会按模式显示所需字段，scopes 与事件均可动态增减。",
            },
            {
                title: "授权并验证能力",
                description:
                    "按所需动作授予 OAuth scopes；保存后在能力面板检查当前账号的权限与事件范围。",
            },
        ],
    ),
    adapter(
        "matrix",
        "Matrix",
        "连接 Matrix homeserver，支持 /sync、Application Service 和手动接入。",
        [
            {
                title: "准备 Matrix 机器人身份",
                description:
                    "创建专用 Matrix 用户并获取 Access Token；若使用 AppService，同时准备 homeserver registration。",
                url: "https://spec.matrix.org/latest/client-server-api/#get_matrixclientv3accountwhoami",
            },
            {
                title: "选择事件接收方式",
                description:
                    "普通机器人使用 /sync；homeserver 集成使用 AppService；已有连接或 Host 使用 manual。",
            },
            {
                title: "填写凭据与事件类型",
                description:
                    "安装并重启后，Web 表单会按接收方式显示所需 token、挂载路径和可动态增减的事件类型。",
            },
            {
                title: "保存并验证身份",
                description: "保存后 OneBots 会调用 whoami 核对 user_id，并自动热重载账号。",
            },
        ],
    ),
    adapter("slack", "Slack", "连接 Slack 工作区，支持 Socket Mode 和 Events API。", [
        {
            title: "创建 Slack App",
            description: "在 Slack API 控制台创建应用并选择要接入的工作区。",
            url: "https://api.slack.com/apps",
        },
        {
            title: "配置权限并安装",
            description:
                "添加所需 Bot Token Scopes 和事件订阅，将应用安装到工作区，复制 xoxb- 开头的 Bot Token。",
            url: "https://api.slack.com/tutorials/tracks/getting-a-token",
        },
        {
            title: "启用 Socket Mode",
            description:
                "推荐启用 Socket Mode，创建带 connections:write 权限且以 xapp- 开头的 App Token。",
            url: "https://api.slack.com/apis/connections/socket-implement",
        },
        {
            title: "在 OneBots 中完成配置",
            description: "重启后填写 Bot Token、App Token 和账号标识，保存后自动加载。",
        },
    ]),
    adapter("telegram", "Telegram", "通过 Telegram Bot API 接入机器人。", [
        {
            title: "创建 Telegram Bot",
            description: "在 Telegram 中联系 @BotFather 创建机器人并复制 Bot Token。",
            url: "https://core.telegram.org/bots/tutorial",
        },
        ...genericSetup.slice(1),
    ]),
    adapter("qq", "QQ 官方机器人", "接入 QQ 开放平台官方机器人。", genericSetup),
    adapter("discord", "Discord", "连接 Discord Bot 和频道。", genericSetup),
    adapter("dingtalk", "钉钉", "连接钉钉机器人和应用。", genericSetup),
    adapter("feishu", "飞书", "连接飞书开放平台应用。", genericSetup),
    adapter("kook", "KOOK", "连接 KOOK 机器人。", genericSetup),
    adapter("teams", "Microsoft Teams", "连接 Microsoft Teams Bot。", genericSetup),
    adapter("wecom", "企业微信", "连接企业微信自建应用。", genericSetup),
    adapter("wecom-kf", "微信客服", "连接企业微信微信客服。", genericSetup),
    adapter("wechat", "微信公众号", "连接微信公众号。", genericSetup),
    adapter("wechat-clawbot", "微信 ClawBot", "通过 ClawBot 接入微信。", genericSetup),
    adapter("whatsapp", "WhatsApp", "连接 WhatsApp Business。", genericSetup),
    adapter("line", "LINE", "连接 LINE Messaging API。", genericSetup),
    adapter("email", "电子邮件", "通过 IMAP/SMTP 收发消息。", genericSetup),
    adapter("zulip", "Zulip", "连接 Zulip Bot。", genericSetup),
    adapter("heychat", "黑盒语音", "连接黑盒语音机器人。", genericSetup),
    adapter("icqq", "ICQQ", "通过 ICQQ 接入 QQ。", genericSetup),
    protocol("onebot-v11", "onebot.v11", "OneBot v11", "提供 OneBot v11 HTTP 与 WebSocket 接口。"),
    protocol("onebot-v12", "onebot.v12", "OneBot v12", "提供 OneBot v12 标准接口。"),
    protocol("satori-v1", "satori.v1", "Satori v1", "提供 Satori v1 协议接口。"),
    protocol("milky-v1", "milky.v1", "Milky v1", "提供 Milky v1 协议接口。"),
    protocol("mcp-v1", "mcp.v1", "MCP v1", "将机器人能力暴露为 MCP 工具。"),
];

export function getExtensionCatalogEntry(id: string): ExtensionCatalogEntry | undefined {
    return EXTENSION_CATALOG.find(entry => entry.id === id);
}
