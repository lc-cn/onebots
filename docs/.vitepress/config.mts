import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
import { versions, getCurrentVersion, getOtherVersions } from "./version-selector.js";
import { withVersioning } from "./plugins/versioning.js";

const pkg = require("../../package.json");

// 版本配置
const versioningOptions = {
    versions: versions,
    currentVersion: getCurrentVersion()?.version,
    position: 'end' as const
};

// 基础配置
const baseConfig = defineConfig({
    title: "onebots",
    titleTemplate: ":title - onebots",
    head: [["meta", { name: "theme-color", content: "#3c8772" }]],
    srcDir: "./src",
    outDir: "./dist",
    lastUpdated: true,
    ignoreDeadLinks: true,

    // 多语言配置
    locales: {
        root: {
            label: "简体中文",
            lang: "zh-CN",
            description: "基于NodeJS的 M Platform => N Protocol 解决方案",
            themeConfig: {
                nav: [
                    { text: "开始", link: "/guide/start", activeMatch: "/guide/" },
                    {
                        text: "配置",
                        items: [
                            { text: "全局配置", link: "/config/global" },
                            { text: "通用配置", link: "/config/general" },
                            { text: "平台配置", link: "/config/platform" },
                            { text: "协议配置", link: "/config/protocol" }
                        ]
                    },
                    {
                        text: "平台",
                        items: [
                            { text: "微信公众号", link: "/platform/wechat" },
                            { text: "微信 ClawBot (iLink)", link: "/platform/wechat-clawbot" },
                            { text: "QQ机器人", link: "/platform/qq" },
                            { text: "ICQQ", link: "/platform/icqq" },
                            { text: "钉钉机器人", link: "/platform/dingtalk" },
                            { text: "Discord", link: "/platform/discord" },
                            { text: "Kook", link: "/platform/kook" },
                            { text: "Telegram", link: "/platform/telegram" },
                            { text: "飞书", link: "/platform/feishu" },
                            { text: "Line", link: "/platform/line" },
                            { text: "Slack", link: "/platform/slack" },
                            { text: "企业微信", link: "/platform/wecom" },
                            { text: "微信客服", link: "/platform/wecom-kf" },
                            { text: "Microsoft Teams", link: "/platform/teams" },
                            { text: "邮件", link: "/platform/email" },
                            { text: "WhatsApp", link: "/platform/whatsapp" },
                            { text: "Zulip", link: "/platform/zulip" }
                        ]
                    },
                    {
                        text: "协议",
                        items: [
                            { text: "OneBot V11", link: "/protocol/onebot-v11" },
                            { text: "OneBot V12", link: "/protocol/onebot-v12" },
                            { text: "Satori", link: "/protocol/satori" },
                            { text: "Milky", link: "/protocol/milky" }
                        ]
                    },
                    {
                        text: pkg.version,
                        items: [
                            {
                                text: "Package", link: `https://www.npmjs.com/package/onebots/v/` + pkg.version
                            },
                            {
                                text: "Release", link: `https://github.com/lc-cn/onebots/releases/tag/v` + pkg.version
                            },
                            { text: "Changelog", link: "https://github.com/icqqjs/onebots/blob/master/CHANGELOG.md" }
                        ]
                    }
                ],
                sidebar: {
                    "/guide/": [
                        { text: `准备工作`, link: "/guide/prepare" },
                        { text: `快速开始`, link: "/guide/start" },
                        { text: `Docker 部署`, link: "/guide/docker" },
                        { text: `系统架构`, link: "/guide/architecture" },
                        { text: `客户端SDK`, link: "/guide/client-sdk" },
                        { text: `开发适配器`, link: "/guide/adapter" },
                        { text: `适配器开发计划`, link: "/guide/adapter-todo" }
                    ],
                    "/config/": [
                        { text: "全局配置", link: "/config/global" },
                        { text: "通用配置 (general)", link: "/config/general" },
                        { text: "平台配置", link: "/config/platform" },
                        { text: "协议配置", link: "/config/protocol" }
                    ],
                    "/platform/": [
                        { text: "微信公众号", link: "/platform/wechat" },
                        { text: "微信 ClawBot (iLink)", link: "/platform/wechat-clawbot" },
                        { text: "QQ机器人", link: "/platform/qq" },
                        { text: "ICQQ", link: "/platform/icqq" },
                        { text: "Discord", link: "/platform/discord" },
                        { text: "钉钉机器人", link: "/platform/dingtalk" },
                        { text: "Kook", link: "/platform/kook" },
                        { text: "Telegram", link: "/platform/telegram" },
                        { text: "飞书", link: "/platform/feishu" },
                        { text: "Line", link: "/platform/line" },
                        { text: "Slack", link: "/platform/slack" },
                        { text: "企业微信", link: "/platform/wecom" },
                        { text: "微信客服", link: "/platform/wecom-kf" },
                        { text: "Microsoft Teams", link: "/platform/teams" },
                        { text: "邮件", link: "/platform/email" },
                        { text: "WhatsApp", link: "/platform/whatsapp" },
                        { text: "Zulip", link: "/platform/zulip" }
                    ],
                    "/protocol/": [
                        { text: "OneBot V11", link: "/protocol/onebot-v11" },
                        { text: "OneBot V12", link: "/protocol/onebot-v12" },
                        { text: "Satori", link: "/protocol/satori" },
                        { text: "Milky", link: "/protocol/milky" }
                    ]
                },
                footer: {
                    message: "Released under the <a href=\"https://github.com/icqqjs/onebots/blob/master/LICENSE\">MIT License</a>.",
                    copyright: "Copyright © 2022-2024 <a href=\"https://github.com/lc-cn\">凉菜</a>"
                },
                    editLink: {
                        pattern: "https://github.com/icqqjs/onebots/edit/master/docs/src/:path",
                        text: "参与贡献"
                    },
                socialLinks: [{ icon: "github", link: "https://github.com/icqqjs/onebots" }],
                lastUpdated: {
                    text: "上次更新时间"
                },
                docFooter: {
                    prev: "上一节",
                    next: "下一节"
                },
                outline: {
                    label: "页面导航"
                },
                returnToTopLabel: "返回顶部",
                darkModeSwitchLabel: "主题",
                sidebarMenuLabel: "菜单",
                langMenuLabel: "切换语言"
            }
        },
        en: {
            label: "English",
            lang: "en-US",
            link: "/en/",
            description: "Multi-platform multi-protocol robot application framework",
            themeConfig: {
                nav: [
                    { text: "Get Started", link: "/en/guide/start", activeMatch: "/en/guide/" },
                    { text: "Architecture", link: "/en/guide/architecture" },
                    {
                        text: "Configuration",
                        items: [
                            { text: "Global Config", link: "/en/config/global" },
                            { text: "General Config", link: "/en/config/general" },
                            { text: "Platform Config", link: "/en/config/platform" },
                            { text: "Protocol Config", link: "/en/config/protocol" }
                        ]
                    },
                    {
                        text: "Platforms",
                        items: [
                            { text: "WeChat", link: "/en/platform/wechat" },
                            { text: "WeChat ClawBot (iLink)", link: "/en/platform/wechat-clawbot" },
                            { text: "QQ", link: "/en/platform/qq" },
                            { text: "ICQQ", link: "/en/platform/icqq" },
                            { text: "DingTalk", link: "/en/platform/dingtalk" },
                            { text: "Discord", link: "/en/platform/discord" },
                            { text: "Kook", link: "/en/platform/kook" },
                            { text: "Telegram", link: "/en/platform/telegram" },
                            { text: "Feishu", link: "/en/platform/feishu" },
                            { text: "Line", link: "/en/platform/line" },
                            { text: "Slack", link: "/en/platform/slack" },
                            { text: "WeCom", link: "/en/platform/wecom" },
                            { text: "WeCom KF", link: "/en/platform/wecom-kf" },
                            { text: "Microsoft Teams", link: "/en/platform/teams" },
                            { text: "Email", link: "/en/platform/email" },
                            { text: "WhatsApp", link: "/en/platform/whatsapp" },
                            { text: "Zulip", link: "/en/platform/zulip" }
                        ]
                    },
                    {
                        text: "Protocols",
                        items: [
                            { text: "OneBot V11", link: "/en/protocol/onebot-v11" },
                            { text: "OneBot V12", link: "/en/protocol/onebot-v12" },
                            { text: "Satori", link: "/en/protocol/satori" },
                            { text: "Milky", link: "/en/protocol/milky" }
                        ]
                    },
                    {
                        text: getCurrentVersion()?.label || `v${pkg.version}`,
                        items: [
                            // 当前版本链接
                            {
                                text: `v${pkg.version} (Current)`,
                                link: "/en/"
                            },
                            // 其他版本
                            ...getOtherVersions().map(v => ({
                                text: v.label,
                                link: `/en${v.link}`
                            })),
                            // 外部链接
                            {
                                text: "NPM Package",
                                link: `https://www.npmjs.com/package/onebots/v/${pkg.version}`
                            },
                            {
                                text: "GitHub Release",
                                link: `https://github.com/lc-cn/onebots/releases/tag/v${pkg.version}`
                            },
                            { text: "Changelog", link: "https://github.com/icqqjs/onebots/blob/master/CHANGELOG.md" }
                        ]
                    }
                ],
                sidebar: {
                    "/en/guide/": [
                        { text: "Preparation", link: "/en/guide/prepare" },
                        { text: "Quick Start", link: "/en/guide/start" },
                        { text: "Docker Deployment", link: "/en/guide/docker" },
                        { text: "Architecture", link: "/en/guide/architecture" },
                        { text: "Client SDK", link: "/en/guide/client-sdk" },
                        { text: "Adapter Development", link: "/en/guide/adapter" },
                        { text: "Adapter Roadmap", link: "/en/guide/adapter-todo" }
                    ],
                    "/en/config/": [
                        { text: "Global Config", link: "/en/config/global" },
                        { text: "General Config", link: "/en/config/general" },
                        { text: "Platform Config", link: "/en/config/platform" },
                        { text: "Protocol Config", link: "/en/config/protocol" }
                    ],
                    "/en/platform/": [
                        { text: "WeChat", link: "/en/platform/wechat" },
                        { text: "WeChat ClawBot (iLink)", link: "/en/platform/wechat-clawbot" },
                        { text: "QQ", link: "/en/platform/qq" },
                        { text: "ICQQ", link: "/en/platform/icqq" },
                        { text: "Discord", link: "/en/platform/discord" },
                        { text: "DingTalk", link: "/en/platform/dingtalk" },
                        { text: "Kook", link: "/en/platform/kook" },
                        { text: "Telegram", link: "/en/platform/telegram" },
                        { text: "Feishu", link: "/en/platform/feishu" },
                        { text: "Line", link: "/en/platform/line" },
                        { text: "Slack", link: "/en/platform/slack" },
                        { text: "WeCom", link: "/en/platform/wecom" },
                        { text: "WeCom KF", link: "/en/platform/wecom-kf" },
                        { text: "Microsoft Teams", link: "/en/platform/teams" },
                        { text: "Email", link: "/en/platform/email" },
                        { text: "WhatsApp", link: "/en/platform/whatsapp" },
                        { text: "Zulip", link: "/en/platform/zulip" }
                    ],
                    "/en/protocol/": [
                        { text: "OneBot V11", link: "/en/protocol/onebot-v11" },
                        { text: "OneBot V12", link: "/en/protocol/onebot-v12" },
                        { text: "Satori", link: "/en/protocol/satori" },
                        { text: "Milky", link: "/en/protocol/milky" }
                    ]
                },
                footer: {
                    message: "Released under the <a href=\"https://github.com/icqqjs/onebots/blob/master/LICENSE\">MIT License</a>.",
                    copyright: "Copyright © 2022-2024 <a href=\"https://github.com/lc-cn\">凉菜</a>"
                },
                editLink: {
                    pattern: "https://github.com/icqqjs/onebots/edit/master/docs/src/en/:path",
                    text: "Edit this page"
                },
                socialLinks: [{ icon: "github", link: "https://github.com/icqqjs/onebots" }],
                lastUpdated: {
                    text: "Last updated"
                },
                docFooter: {
                    prev: "Previous",
                    next: "Next"
                },
                outline: {
                    label: "On this page"
                },
                returnToTopLabel: "Return to top",
                darkModeSwitchLabel: "Appearance",
                sidebarMenuLabel: "Menu",
                langMenuLabel: "Change language"
            }
        }
    },

    markdown: {
        async config(md) {
        }
    },
    
    vite: {
        optimizeDeps: {
            include: ['dayjs', 'element-plus', 'mermaid', 'd3-sankey'],
            esbuildOptions: {
                target: 'esnext'
            }
        },
        ssr: {
            noExternal: ['dayjs', 'mermaid', 'd3-sankey']
        },
        resolve: {
            dedupe: ['dayjs']
        },
        build: {
            rollupOptions: {
                onwarn(warning, warn) {
                    // Ignore d3-sankey resolution warning as it's handled at runtime
                    if (warning.code === 'UNRESOLVED_IMPORT' && warning.exporter?.includes('d3-sankey')) {
                        return
                    }
                    warn(warning)
                }
            }
        }
    },

    // Mermaid 配置
    mermaid: {
        // 启用缩放和平移
        startOnLoad: true,
        securityLevel: 'loose',
        flowchart: {
            useMaxWidth: true,
            htmlLabels: true
        }
    },
    mermaidPlugin: {
        class: "mermaid"
    }
});

// 应用版本管理和 Mermaid 插件
export default withMermaid(withVersioning(baseConfig, versioningOptions));
