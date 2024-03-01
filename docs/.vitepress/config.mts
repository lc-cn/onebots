import { defineConfig } from "vitepress";
const pkg = require("../../package.json")
export default defineConfig({
    title: "OneBots",
    titleTemplate: ":title - OneBots",
    head: [["meta", { name: "theme-color", content: "#3c8772" }]],
    srcDir: "./src",
    outDir: "./dist",
    description: "基于icqq的OneBot实现",
    markdown: {
        async config(md) {
        }
    },
    lang: "zh-CN",
    lastUpdated: true,
    ignoreDeadLinks: true,
    themeConfig: {
        nav: [
            { text: "开始", link: "/guide/index", activeMatch: "/guide/" },
            {
                text: "配置",
                items: [
                    { text: "全局配置", link: "/config/global" },
                    { text: "V11", link: "/config/v11" },
                    { text: "V12", link: "/config/v12" }
                ]
            },
            {
                text: "适配器",
                items: [
                    { text: "ICQQ", link: "/adapter/icqq" },
                    { text: "QQ", link: "/adapter/qq" },
                    { text: "微信", link: "/adapter/wechat" },
                    { text: "钉钉", link: "/adapter/dingtalk" },
                ]
            },
            {
                text: "V11",
                items: [
                    { text: "动作 (Action)", link: "/v11/action" },
                    { text: "事件 (Event)", link: "/v11/event" },
                    { text: "CQ码 (CQ CODE)", link: "/v11/cqcode" }
                ]
            },
            {
                text: "V12",
                items: [
                    { text: "动作 (Action)", link: "/v12/action" },
                    { text: "事件 (Event)", link: "/v12/event" },
                    { text: "消息段 (Segment)", link: "/v12/segment" }
                ]
            },
            {
                text: pkg.version,
                items: [
                    {
                      text: "Release", link: `https://github.com/lc-cn/onebots/releases/tag/v`+pkg.version
                    },
                    { text: "Changelog", link: "https://github.com/icqqjs/onebots/blob/master/CHANGELOG.md" }
                ]
            }
        ],
        sidebar: {
            "/guide/": [
                { text: `准备工作`, link: "/guide/prepare" },
                { text: `开始`, link: "/guide/start" },
                { text: `适配器`, link: "/guide/adapter"}
            ],
            "/config": [
                { text: "全局配置", link: "/config/global" },
                { text: "V11", link: "/config/v11" },
                { text: "V12", link: "/config/v12" }
            ],
            "/adapter": [
                { text: "ICQQ", link: "/adapter/icqq" },
                { text: "QQ", link: "/adapter/qq" },
                { text: "微信", link: "/adapter/wechat" },
                { text: "钉钉", link: "/adapter/dingtalk" },
            ],
            "/v11/": [
                { text: "动作 (Action)", link: "/v11/action" },
                { text: "事件 (Event)", link: "/v11/event" },
                { text: "CQ码 (CQ CODE)", link: "/v11/cqcode" }
            ],
            "/v12/": [
                { text: "动作 (Action)", link: "/v12/action" },
                { text: "事件 (Event)", link: "/v12/event" },
                { text: "消息段 (Segment)", link: "/v12/segment" }
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
            text:'上次更新时间'
        },
        docFooter: {
            prev: "上一节",
            next: "下一节"
        }
    }
});
