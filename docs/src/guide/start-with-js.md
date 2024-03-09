# 通过 `node ./index.js` 启动
::: tip
请确保你已完成 [上手](./start.md)章节的 1-3步
:::
## 1. 在当前项目的根目录创建 `index.js` 文件，并录入一下内容：
```javascript
const {App,createOnebots} = require('onebots')

App.registerAdapter('icqq') // 如不需要使用icqq，请注释改行
App.registerAdapter('qq') // 如不需要使用qq官方机器人，请注释改行
App.registerAdapter('dingtalk') // 如不需要使用钉钉机器人，请注释改行
App.registerAdapter('wechat') // 如不需要使用微信机器人，请注释改行

createOnebots({
    port: 5727, // 监听端口 (选填) 
    username: 'admin', // web面板登录账号 (选填) 
    password: '123456', // web面板登录密码 (选填) 
    log_level: 'info', // 日志输出等级 (选填) 
    [`icqq.147258369`]: { // icqq 配置 (选填) 

    },
    ['qq.147258369']:{ // qq 配置 (选填) 
        
    },
    ['dingtalk.123456']:{ //dingtalk 配置 (选填) 
    },
    ['wechat.123456']:{ //wechat 配置 (选填) 
    }
}).start()
```
## 2. 启动
```shell
node ./index.js
```
