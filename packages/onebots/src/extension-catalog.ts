export type ExtensionType = "adapter" | "protocol";

export interface ExtensionSetupStep {
    title: string;
    description: string;
    url?: string;
}

export interface ExtensionCatalogEntry {
    id: string;
    type: ExtensionType;
    name: string;
    displayName: string;
    description: string;
    packageName: string;
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
    setup,
});

const protocol = (
    name: string,
    displayName: string,
    description: string,
): ExtensionCatalogEntry => ({
    id: `protocol:${name}`,
    type: "protocol",
    name,
    displayName,
    description,
    packageName: `@onebots/protocol-${name}`,
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
    protocol("onebot-v11", "OneBot v11", "提供 OneBot v11 HTTP 与 WebSocket 接口。"),
    protocol("onebot-v12", "OneBot v12", "提供 OneBot v12 标准接口。"),
    protocol("satori-v1", "Satori v1", "提供 Satori v1 协议接口。"),
    protocol("milky-v1", "Milky v1", "提供 Milky v1 协议接口。"),
    protocol("mcp-v1", "MCP v1", "将机器人能力暴露为 MCP 工具。"),
];

export function getExtensionCatalogEntry(id: string): ExtensionCatalogEntry | undefined {
    return EXTENSION_CATALOG.find(entry => entry.id === id);
}
