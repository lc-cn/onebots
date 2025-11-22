<div align="center">
    <h1>使用ts实现的oneBot应用启动器，支持icqq、qq官方机器人、微信以及钉钉机器人</h1>
    <p>

[![Build Package](https://github.com/icqqjs/onebots/actions/workflows/release.yml/badge.svg?branch=master&event=push)](https://github.com/icqqjs/onebots/actions/workflows/release.yml) [![Build Docs](https://github.com/lc-cn/onebots/actions/workflows/build_deploy_docs.yml/badge.svg)](https://github.com/lc-cn/onebots/actions/workflows/build_deploy_docs.yml)

[![npm](https://img.shields.io/npm/v/onebots)](https://www.npmjs.com/package/onebots) [![dm](https://shields.io/npm/dm/onebots)](https://www.npmjs.com/package/onebots) [![oneBot V11](https://img.shields.io/badge/OneBot-11-black?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAABwCAMAAADxPgR5AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAAxQTFRF////29vbr6+vAAAAk1hCcwAAAAR0Uk5T////AEAqqfQAAAKcSURBVHja7NrbctswDATQXfD//zlpO7FlmwAWIOnOtNaTM5JwDMa8E+PNFz7g3waJ24fviyDPgfhz8fHP39cBcBL9KoJbQUxjA2iYqHL3FAnvzhL4GtVNUcoSZe6eSHizBcK5LL7dBr2AUZlev1ARRHCljzRALIEog6H3U6bCIyqIZdAT0eBuJYaGiJaHSjmkYIZd+qSGWAQnIaz2OArVnX6vrItQvbhZJtVGB5qX9wKqCMkb9W7aexfCO/rwQRBzsDIsYx4AOz0nhAtWu7bqkEQBO0Pr+Ftjt5fFCUEbm0Sbgdu8WSgJ5NgH2iu46R/o1UcBXJsFusWF/QUaz3RwJMEgngfaGGdSxJkE/Yg4lOBryBiMwvAhZrVMUUvwqU7F05b5WLaUIN4M4hRocQQRnEedgsn7TZB3UCpRrIJwQfqvGwsg18EnI2uSVNC8t+0QmMXogvbPg/xk+Mnw/6kW/rraUlvqgmFreAA09xW5t0AFlHrQZ3CsgvZm0FbHNKyBmheBKIF2cCA8A600aHPmFtRB1XvMsJAiza7LpPog0UJwccKdzw8rdf8MyN2ePYF896LC5hTzdZqxb6VNXInaupARLDNBWgI8spq4T0Qb5H4vWfPmHo8OyB1ito+AysNNz0oglj1U955sjUN9d41LnrX2D/u7eRwxyOaOpfyevCWbTgDEoilsOnu7zsKhjRCsnD/QzhdkYLBLXjiK4f3UWmcx2M7PO21CKVTH84638NTplt6JIQH0ZwCNuiWAfvuLhdrcOYPVO9eW3A67l7hZtgaY9GZo9AFc6cryjoeFBIWeU+npnk/nLE0OxCHL1eQsc1IciehjpJv5mqCsjeopaH6r15/MrxNnVhu7tmcslay2gO2Z1QfcfX0JMACG41/u0RrI9QAAAABJRU5ErkJggg==)](https://onebot.dev/)
[![oneBot V12](https://img.shields.io/badge/OneBot-12-black?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAABwCAMAAADxPgR5AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAAxQTFRF////29vbr6+vAAAAk1hCcwAAAAR0Uk5T////AEAqqfQAAAKcSURBVHja7NrbctswDATQXfD//zlpO7FlmwAWIOnOtNaTM5JwDMa8E+PNFz7g3waJ24fviyDPgfhz8fHP39cBcBL9KoJbQUxjA2iYqHL3FAnvzhL4GtVNUcoSZe6eSHizBcK5LL7dBr2AUZlev1ARRHCljzRALIEog6H3U6bCIyqIZdAT0eBuJYaGiJaHSjmkYIZd+qSGWAQnIaz2OArVnX6vrItQvbhZJtVGB5qX9wKqCMkb9W7aexfCO/rwQRBzsDIsYx4AOz0nhAtWu7bqkEQBO0Pr+Ftjt5fFCUEbm0Sbgdu8WSgJ5NgH2iu46R/o1UcBXJsFusWF/QUaz3RwJMEgngfaGGdSxJkE/Yg4lOBryBiMwvAhZrVMUUvwqU7F05b5WLaUIN4M4hRocQQRnEedgsn7TZB3UCpRrIJwQfqvGwsg18EnI2uSVNC8t+0QmMXogvbPg/xk+Mnw/6kW/rraUlvqgmFreAA09xW5t0AFlHrQZ3CsgvZm0FbHNKyBmheBKIF2cCA8A600aHPmFtRB1XvMsJAiza7LpPog0UJwccKdzw8rdf8MyN2ePYF896LC5hTzdZqxb6VNXInaupARLDNBWgI8spq4T0Qb5H4vWfPmHo8OyB1ito+AysNNz0oglj1U955sjUN9d41LnrX2D/u7eRwxyOaOpfyevCWbTgDEoilsOnu7zsKhjRCsnD/QzhdkYLBLXjiK4f3UWmcx2M7PO21CKVTH84638NTplt6JIQH0ZwCNuiWAfvuLhdrcOYPVO9eW3A67l7hZtgaY9GZo9AFc6cryjoeFBIWeU+npnk/nLE0OxCHL1eQsc1IciehjpJv5mqCsjeopaH6r15/MrxNnVhu7tmcslay2gO2Z1QfcfX0JMACG41/u0RrI9QAAAABJRU5ErkJggg==)](https://12.onebot.dev/) [![node engine](https://img.shields.io/node/v/onebots?color=339933&style=flat-square&labelColor=FAFAFA&logo=Node.js)](https://nodejs.org)
[![qq group](https://img.shields.io/badge/group-860669870-blue?style=flat-square&labelColor=FAFAFA&logo=data:image/png;base64,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&logoColor=000000)](https://jq.qq.com/?_wv=1027&k=B22VGXov)

[Docs](https://docs.onebots.org)

</p>
</div>

## 🎉 最新重构

项目已完成重构，带来以下改进：

- ✨ **多协议支持**：现在支持扩展多种协议（OneBot、Milky、Satori 等）
- 🚀 **性能提升**：使用 Node.js 内置 SQLite 替代文件数据库
- 🏗️ **架构优化**：清晰的协议抽象层，更易于添加新平台和协议
- 🔗 **新 URL 结构**：支持 `/{platform}/{uin}/{protocol}/{version}` 格式
- 📝 **向后兼容**：完全兼容旧版本的 URL 和配置

详细信息：

- [迁移指南](./MIGRATION.md) - 如何从旧版本升级
- [架构文档](./ARCHITECTURE.md) - 了解新架构设计

---

# 使用示例

## 全局安装(0.4.8以后不推荐)

### 1 安装依赖

- 注意：

```shell
npm install -g onebots
```

### 2 初始化配置文件

在你想存放配置文件的目录执行如下命令

```shell
onebots
```

### 3 更改生成的默认配置文件成你想要的配置配置后再次运行上面的指令，启动项目

## 局部安装

## 1 初始化node项目

```shell
npm init -y
```

## 2. 安装onebots以及对应适配器的依赖

```shell
npm install onebots
npm install @icqqjs/icqq # 如需使用icqq适配器，请务必安装
npm install web-wechat # 如需使用微信适配器，请务必安装
npm install qq-official-bot # 如需使用qq官方机器人适配器，请务必安装
npm install node-dd-bot # 如需使用钉钉机器人适配器，请务必安装
```

- 关于@icqqjs的安装引导：

**安装:**

1. 在你的项目根目录新建文件 `.npmrc` ,并录入以下内容

```text
@icqqjs:registry=https://npm.pkg.github.com
```

2. 命令行输入 `npm login --scope=@icqqjs --auth-type=legacy --registry=https://npm.pkg.github.com` ，回车，根据提示登录github

```shell
npm login --scope=@icqqjs --auth-type=legacy --registry=https://npm.pkg.github.com

UserName: # 你的github账号
Password: # 前往 https://github.com/settings/tokens/new  获取，scopes勾选 read:packages
E-Mail: # 你的公开邮箱地址
```

3. 安装依赖

```shell
npm install @icqqjs/icqq  # or > yarn add @icqqjs/icqq
```

## 3. 执行如下命令生成配置文件

```shell
npx onebots -r icqq #注册icqq适配器并启动onebots
npx onebots -r wechat #注册微信适配器并启动onebots
npx onebots -r qq #注册qq官方适配器并启动onebots
npx onebots -r dingtalk #注册钉钉适配器并启动onebots
# 你也可以同时注册多个适配器，多次使用-r即可，例如 npx onebots -r qq -r icqq -r wechat
```

## 4. 更改生成的默认配置文件成你想要的配置配置后再次运行上面的指令，启动项目

# 默认配置文件

```yaml
port: 6727 # 监听端口
log_level: info # 日志等级
platform: 5 # 机器人客户端协议（1:Android 2:APad 3:Watch 4:IMac 5:IPad）
timeout: 30 #登录超时时间(秒)
general: # 通用配置，在单个配置省略时的默认值
  V11: # oneBotV11的通用配置
    heartbeat: 3 # 心跳间隔 (秒)
    access_token: "" # 访问api的token
    post_timeout: 15 # 上报超时时间，(秒)
    secret: "" # 上报数据的sha1签名密钥
    rate_limit_interval: 4 # ws心跳间隔(秒)
    post_message_format: string # "string"或"array"
    reconnect_interval: 3 # 重连间隔 (秒)
    use_http: true # 是否使用 http
    enable_cors: true # 是否允许跨域
    filters: {} # 过滤器配置
    use_ws: true # 是否使用websocket
    http_reverse: [] # http上报地址
    ws_reverse: [] # 反向ws连接地址
  V12: # oneBotV12的通用配置
    heartbeat: 3 # 心跳间隔 (秒)
    access_token: "" # 访问api的token
    request_timeout: 15 # 上报超时时间 (秒)
    reconnect_interval: 3 # 重连间隔 (秒)
    enable_cors: true # 是否允许跨域
    use_http: true # 是否启用http
    use_ws: true # 是否启用 websocket
    filters: {} # 过滤器配置
    webhook: [] # http 上报地址
    ws_reverse: [] # 反向ws连接地址
  protocol:
    platform: 2
    sign_api_addr: "" #你的签名地址
    password: "" # 账号密码，未配置则扫码登陆
    # ...其他配置项参考icqq的Config配置
# 每个账号的单独配置(用于覆盖通用配置)
icqq.123456789:
  password: "" # 账号密码，未配置则扫码登陆
  version: V11 # 使用的oneBot版本
  # ...其他配置项参见上方对应oneBot版本的通用配置
  protocol:
    platform: 2
    sign_api_addr: "" #你的签名地址
    # ...其他配置项参考icqq的Config配置

qq.123456789: # `${适配器名称}:${appId}`
  versions:
    - version: V11
  # 。。。其他配置项参见上方对应oneBot版本的通用配置
  protocol: # 将会覆盖通用配置中的protocol
    token: "" # qq机器人token
    secret: "" # qq机器人secret
    sandbox: false # 是否沙箱环境
    intents: # 需要监听的intents
      - "GROUP_AT_MESSAGE_CREATE" # 群聊@事件 没有群聊权限请注释
      - "C2C_MESSAGE_CREATE" # 私聊事件 没有私聊权限请注释
      - "DIRECT_MESSAGE" # 频道私信事件
      #     - 'GUILD_MESSAGES' # 私域机器人频道消息事件，公域机器人请注释
      - "GUILDS" # 频道变更事件
      - "GUILD_MEMBERS" # 频道成员变更事件
      - "GUILD_MESSAGE_REACTIONS" # 频道消息表态事件
      - "INTERACTION" # 互动事件
      - "PUBLIC_GUILD_MESSAGES" # 公域机器人频道消息事件，私域机器人请注释
  # 。。。其他配置项参见上方对应oneBot版本的通用配置

dingtalk.abcedfg: # `${适配器名称}:${clientId}`
  versions:
    - version: V11
    - version: V12
  protocol:
    clientSecret: "" # 钉钉机器人秘钥 必填
    username: "钉钉机器人" #钉钉后台配置的机器人名称 不填则显示'钉钉机器人'
    avatar: "" # 机器人头像 不填则显示钉钉logo

wechat.bot1: # `${适配器名称}:${机器人唯一标识}`
  versions:
    - version: V11
    - version: V12
  protocol: {}
```

# 配置解释

## Config

| 配置项             | 类型                            | 默认值  | desc         |
| :----------------- | :------------------------------ | :------ | :----------- |
| port               | number                          | 6727    | 服务监听端口 |
| logLevel           | string                          | info    | 日志级别     |
| general            | {V11:V11.Config,V12:V12.Config} | general | 通用配置     |
| [adapter].[number] | OneBotConfig                    | -       | 机器人配置   |

## OneBotConfig

| 配置项   | 类型                     | 默认值    | desc                                            |
| :------- | :----------------------- | :-------- | :---------------------------------------------- |
| password | string                   | -         | 仅icqq生效，账号密码 未填写或填写为空则扫码登陆 |
| V11      | V11.Config               | configV11 | V11配置                                         |
| V12      | V12.Config               | configV12 | V12配置                                         |
| protocol | 传递给client初始化的配置 | {}        |                                                 |

## ConfigV11

| 配置项              | 类型     | 默认值 | desc              |
| :------------------ | :------- | :----- | :---------------- |
| heartbeat           | number   | 3      | 心跳间隔 单位：秒 |
| access_token        | string   | -      | 访问令牌          |
| secret              | string   | -      | 签名密钥          |
| rate_limit_interval | number   | 4      | 限速间隔 单位：秒 |
| post_message_format | string   | string | 消息格式化        |
| reconnect_interval  | number   | 3      | 重连间隔 单位：秒 |
| use_http            | boolean  | false  | 是否使用http协议  |
| enable_cors         | boolean  | false  | 是否允许跨域      |
| filters             | Filters  | {}     | 事件过滤器配置    |
| use_ws              | boolean  | false  | 是否使用ws协议    |
| http_reverse_url    | string[] | -      | http上报地址地址  |
| ws_reverse_url      | string[] | -      | 反向ws连接地址    |

## ConfigV12

| 配置项              | 类型     | 默认值 | desc              |
| :------------------ | :------- | :----- | :---------------- |
| heartbeat           | number   | 3      | 心跳间隔 单位：秒 |
| access_token        | string   | -      | 访问令牌          |
| request_timeout     | number   | 15     | 请求超时 单位：秒 |
| reconnect_interval  | number   | 3      | 重连间隔 单位：秒 |
| enable_cors         | boolean  | false  | 是否允许跨域      |
| filters             | Filters  | {}     | 事件过滤器配置    |
| use_http            | boolean  | false  | 是否使用http协议  |
| use_ws              | boolean  | false  | 是否使用ws协议    |
| webhook_reverse_url | string[] | -      | webhook上报地址   |
| ws_reverse_url      | string[] | -      | 反向ws连接地址    |

# 事件过滤器

## 语法说明

- `onebots` 的事件过滤器最外层是一个JSON对象，其中的键是键如果是运算法，则值作为运算符的参数，如果不是运算符，则表示对事件数据对象相应 `key` 进行过滤。
- 过滤规则中任何一个对象, 只有在它的所有项都匹配的情况下, 才会让事件通过（等价于一个 and 运算），如果值为一个数组，则表示事件对应 `key` 值需满足其中一个。
- 可用逻辑运算符有：`$and` (逻辑与) 、`$or` (逻辑或) 、 `$not` (逻辑非)、`$nor` (逻辑异或)、`$regexp` (文本正则匹配)、`$like` (文本模糊匹配)、`$gt` (数值大于比较)、`$gte` (数值大于等于比较)、`$lt` (数值小于比较)、`$lte` (数值小于等于比较)、`$between` (数值范围比较)

## 示例

### 1. 仅上报私聊事件

```yaml
filters:
  message_type: private
```

### 2. 私聊或指定群聊

```yaml
filters:
  $or:
    message_type: private
    group_id:
      - 123456789 987654321
```

### 3. 私聊事件且不是指定用户

```yaml
filters:
  message_type: private
  $not:
    user_id:
      - 123456789 987654321
```

### 4. 私聊事件(排除指定用户的事件)或指定群聊事件

```yaml
filters:
  $or:
    - message_type: private
      $not:
        user_id: 123456789
    - message_type: group
      group_id: 987654321
```

### 5. 仅上报消息事件且用户年龄大于18岁

```yaml
filters:
  type: message
  sender:
    age:
      $gt: 18
```

### 6. 仅上报消息事件且消息内容以！开头的消息

```yaml
filters:
  type: message
  raw_message:
    .regexp: '^！|\!'
```

### 7. 不上报消息内容包含`cnm`的消息

```yaml
filters:
  $not:
    type: message
    raw_message:
      $like: cnm
```

# 使用API管理oneBot

| url     | method | params          | desc                                           |
| :------ | :----- | :-------------- | :--------------------------------------------- |
| /list   | GET    |                 | 获取当前运行的机器人列表                       |
| /detail | GET    | uin             | 获取指定机器人配置                             |
| /qrcode | GET    | uin             | 获取指定机器人登录二维码                       |
| /add    | POST   | {uin,...config} | 添加机器人 config 为机器人配置                 |
| /edit   | POST   | {uin,...config} | 修改机器人配置 config 为机器人配置             |
| /remove | get    | uin,force       | 移除机器人,force为true时，将删除机器人data目录 |

# 鸣谢

1. [icqqjs/icqq](https://github.com/icqqjs/icqq) 底层服务支持
2. [takayama-lily/onebot](https://github.com/takayama-lily/node-onebot) oneBot V11 原先版本
