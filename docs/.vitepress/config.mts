import {defineConfig} from 'vitepress';

export default defineConfig({
    title: 'OneBots',
    titleTemplate: ':title - OneBots',
    base: '/onebots/',
    head: [['meta', {name: 'theme-color', content: '#3c8772'}]],
    srcDir: './src',
    outDir: './dist',
    description: '基于icqq的OneBot实现',
    markdown: {
        async config(md) {
        }
    },
    lang: 'zh-CN',
    lastUpdated: true,
    ignoreDeadLinks: true,
    themeConfig: {
        nav: [
            {text: '开始', link: '/guide/index', activeMatch: '/guide/'},
            {
                text: '配置',
                items: [
                    {text: '全局配置', link: '/config/global'},
                    {text: 'V11', link: '/config/v11'},
                    {text: 'V12', link: '/config/v12'}
                ]
            },
            {
                text: 'V11',
                items: [
                    {text: '动作 (Action)', link: '/v11/action'},
                    {text: '事件 (Event)', link: '/v11/event'},
                    {text: 'CQ码 (CQ CODE)', link: '/v11/cqcode'}
                ]
            },
            {
                text: 'V12',
                items: [
                    {text: '动作 (Action)', link: '/v12/action'},
                    {text: '事件 (Event)', link: '/v12/event'},
                    {text: '消息段 (Segment)', link: '/v12/segment'}
                ]
            },
            {
                text: require('../../package.json').version,
                items: [
                    {text: 'Changelog', link: 'https://github.com/lc-cn/onebots/blob/master/CHANGELOG.md'}
                ]
            }],
        sidebar: {
            '/guide/': [
                {text: `索引`, link: '/guide/index'},
                {text: `准备工作`, link: '/guide/prepare'},
                {text: `开始`, link: '/guide/start'},
            ],
            '/config': [
                {text: '全局配置', link: '/config/global',},
                {text: 'V11', link: '/config/v11'},
                {text: 'V12', link: '/config/v12',},
            ],
            '/v11/': [
                {text: '动作 (Action)', link: '/v11/action'},
                {text: '事件 (Event)', link: '/v11/event'},
                {text: 'CQ码 (CQ CODE)', link: '/v11/cqcode'}
            ],
            '/v12/': [
                {text: '动作 (Action)', link: '/v12/action'},
                {text: '事件 (Event)', link: '/v12/event'},
                {text: '消息段 (Segment)', link: '/v12/segment'}
            ]
        },
        footer: {
            message: 'Released under the <a href="https://github.com/lc-cn/onebots/blob/master/LICENSE">MIT License</a>.',
            copyright: 'Copyright © 2022-2023 <a href="https://github.com/lc-cn">凉菜</a>'
        },
        editLink: {
            pattern: 'https://github.com/lc-cn/onebots/edit/master/docs/src/:path', text: '修正文档',
        },
        socialLinks: [{icon: 'github', link: 'https://github.com/lc-cn/onebots'}],
        lastUpdatedText: '上次更新时间',
        docFooter: {
            prev: '上一节', next: '下一节'
        }
    }
})
