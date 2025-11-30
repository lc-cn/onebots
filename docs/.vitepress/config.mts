import { defineConfig } from "vitepress";

const pkg = require("../../package.json");
export default defineConfig({
    title: "OneBots",
    titleTemplate: ":title - OneBots",
    head: [["meta", { name: "theme-color", content: "#3c8772" }]],
    srcDir: "./src",
    outDir: "./dist",
    description: "基于NodeJS的 M Platform => N Protocol 解决方案",
    markdown: {
        async config(md) {
        }
    },
    lang: "zh-CN",
    lastUpdated: true,
    ignoreDeadLinks: true,
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
                    { text: "微信", link: "/platform/wechat" },
                    { text: "QQ", link: "/platform/qq" },
                    { text: "钉钉", link: "/platform/dingtalk" },
                    { text: "Kook", link: "/platform/kook" }
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
                { text: `开发适配器`, link: "/guide/adapter" }
            ],
            "/config/": [
                { text: "全局配置", link: "/config/global" },
                { text: "通用配置 (general)", link: "/config/general" },
                { text: "平台配置", link: "/config/platform" },
                { text: "协议配置", link: "/config/protocol" }
            ],
            "/platform/": [
                { text: "微信", link: "/platform/wechat" },
                { text: "QQ", link: "/platform/qq" },
                { text: "钉钉", link: "/platform/dingtalk" },
                { text: "Kook", link: "/platform/kook" }
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
            pattern: "https://github.com/icqqjs/onebots/edit/master/docs/src/:path", text: "参与贡献"
        },
        socialLinks: [{ icon: "github", link: "https://github.com/icqqjs/onebots" }],
        lastUpdated: {
            text: "上次更新时间"
        },
        docFooter: {
            prev: "上一节",
            next: "下一节"
        }
    }
});
