# 快速开始
::: tip
开始之前，请确认是否完成 `NodeJS` 的安装。
如果未安装，请前往 [Prepare](./prepare.md) 完成安装
:::
## 1. 创建项目
- 选择或创建一个文件夹，用于存储 `OneBots` 文件
- 通过命令提示符窗口(Windows)或终端(Mac)(后续简称终端),进入刚才创建的文件夹，执行以下命令，并根据提示完成项目创建
```shell
npm init
```
## 2. 安装 `OneBots`
- 在终端进入项目文件夹，并执行以下命令，安装 `OneBots`
```shell
npm install onebots --legacy-peer-deps # 带上后边这个是为了防止自动安装对等依赖
```
## 3. 安装适配器
- 根据你的需求，选择对应的适配器进行安装

::: tip
### icqq 调整提醒
- icqq 已 private 仅在 github 发布版本，请确保你已加入 `icqqjs` 组织，并在本地完成 GitHub 登录
- Q: 如何加入组织？
- A: 点击 [加入 icqq 群](https://jq.qq.com/?_wv=1027&k=xAdGDRVh)，联系管理员
- Q: 如何完成 GitHub 登录？
- A: 根据下述步骤，即可完成 GitHub 登录
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
:::

::: code-group
```shell [ICQQ]
npm install @icqqjs/icqq --legacy-peer-deps # 带上后边这个是为了防止自动安装对等依赖
```
```shell [QQ官方机器人]
npm install qq-group-bot --legacy-peer-deps # 带上后边这个是为了防止自动安装对等依赖
```
```shell [钉钉机器人]
npm install node-dd-bot --legacy-peer-deps # 带上后边这个是为了防止自动安装对等依赖
```
```shell [微信机器人]
npm install lib-wechat --legacy-peer-deps # 带上后边这个是为了防止自动安装对等依赖
```
:::
## 4. 初始化配置
- 使用以下命令，运行 `OneBots`，首次运行会自动创建配置文件 `config.yaml`
- 不喜欢通过命令启动？前往[node ./index.js](./start-with-js.md)启动方案
```shell
npx onebots
```

## 5. 添加机器人配置
- 此处仅以添加 `icqq` 机器人距离，更多适配器配置请前往 [适配器](/guide/adapter) 了解更多
1. 打开生成的配置文件 `config.yaml`，并更新配置为你的机器人参数
```yaml
port: 6727 # 监听端口
log_level: info # 日志等级
timeout: 30 #登录超时时间(秒)
general: # 通用配置，在单个配置省略时的默认值
  V11: # oneBotV11的通用配置
    heartbeat: 3 # 心跳间隔 (秒)
    access_token: '' # 访问api的token
    post_timeout: 15 # 上报超时时间，(秒)
    secret: '' # 上报数据的sha1签名密钥
    rate_limit_interval: 4 # ws心跳间隔(秒)
    post_message_format: string # "string"或"array"
    reconnect_interval: 3 # 重连间隔 (秒)
    use_http: true # 是否使用 http
    enable_cors: true # 是否允许跨域
    use_ws: true # 是否使用websocket
    http_reverse: [ ] # http上报地址
    ws_reverse: [ ] # 反向ws连接地址
  V12: # oneBotV12的通用配置
    heartbeat: 3 # 心跳间隔 (秒)
    access_token: '' # 访问api的token
    request_timeout: 15 # 上报超时时间 (秒)
    reconnect_interval: 3 # 重连间隔 (秒)
    enable_cors: true # 是否允许跨域
    use_http: true # 是否启用http
    use_ws: true # 是否启用 websocket
    webhook: [ ] # http 上报地址
    ws_reverse: [ ] # 反向ws连接地址
# 每个账号的单独配置(用于覆盖通用配置)
icqq.12345678: # `${适配器名称}:${账号}`# [!code ++]
  versions: # [!code ++]
    - version: V12 # [!code ++]
  # 。。。其他配置项参见上方对应oneBot版本的通用配置 # [!code ++]
  protocol: # 将会覆盖通用配置中的protocol # [!code ++]
    platform: 2 # 登录平台 # [!code ++]
    ver: 8.9.83 # 登录版本 # [!code ++]
    sign_api_addr: http://127.0.0.1/8080/qsign?key=114514 # 签名地址  # [!code ++]
  # 。。。其他配置项参见上方对应oneBot版本的通用配置 # [!code ++]
```
## 6. 启动项目
::: code-group
```shell [ICQQ]
npx onebot -r icqq
```
```shell [QQ官方]
npx onebot -r qq
```
```shell [钉钉机器人]
npx onebot -r dingtalk
```
```shell [微信机器人]
npx onebot -r wechat
```
:::

