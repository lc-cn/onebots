# Start with `node ./index.js`

::: tip
Please ensure you have completed steps 1-3 in the [Getting Started](./start.md) section.
:::

## 1. Create `index.js` file in the project root directory and add the following content:

```javascript
const {App,createOnebots} = require('onebots')

App.registerAdapter('icqq') // Comment this line if you don't need icqq
App.registerAdapter('qq') // Comment this line if you don't need QQ official bot
App.registerAdapter('dingtalk') // Comment this line if you don't need DingTalk bot
App.registerAdapter('wechat') // Comment this line if you don't need WeChat bot

createOnebots({
    port: 5727, // Listening port (optional) 
    username: 'admin', // Web panel login username (optional) 
    password: '123456', // Web panel login password (optional) 
    log_level: 'info', // Log output level (optional) 
    [`icqq.147258369`]: { // icqq configuration (optional) 

    },
    ['qq.147258369']:{ // qq configuration (optional) 
        
    },
    ['dingtalk.123456']:{ //dingtalk configuration (optional) 
    },
    ['wechat.123456']:{ //wechat configuration (optional) 
    }
}).start()
```

## 2. Start

```shell
node ./index.js
```

