# 适配器
::: tip
`OneBots` 基于适配器驱动，使用之前请先安装对应适配器所需的依赖

如已安装，请忽略
:::
## 1. 安装依赖 
请参考 [开始](./start.md#_3-安装适配器)
## 2. 配置
::: code-group
```yaml [ICQQ]
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
icqq.12345678: # `${适配器名称}:${uin}`# [!code ++]
  versions: # [!code ++]
    - version: V12 # [!code ++]
  # 。。。其他配置项参见上方对应oneBot版本的通用配置 # [!code ++]
  protocol: # 将会覆盖通用配置中的protocol # [!code ++]
    platform: 2 # 登录平台 # [!code ++]
    ver: 8.9.83 # 登录版本 # [!code ++]
    sign_api_addr: http://127.0.0.1/8080/qsign?key=114514 # 签名地址  # [!code ++]
  # 。。。其他配置项参见上方对应oneBot版本的通用配置
```
```yaml [QQ官方]
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
qq.102007874: # `${适配器名称}:${appid}` # [!code ++]
  versions: # [!code ++]
    - version: V11 # [!code ++]
  # 。。。其他配置项参见上方对应oneBot版本的通用配置 # [!code ++]
  protocol: # 将会覆盖通用配置中的protocol # [!code ++]
    secret: '' # qq机器人secret # [!code ++]
    sandbox: false # 是否沙箱环境 # [!code ++]
    intents: # 需要监听的intents # [!code ++]
      - 'GROUP_AT_MESSAGE_CREATE' # 群聊@事件 没有群聊权限请注释 # [!code ++]
      - 'C2C_MESSAGE_CREATE' # 私聊事件 没有私聊权限请注释 # [!code ++]
      - 'DIRECT_MESSAGE' # 频道私信事件 # [!code ++]
      #     - 'GUILD_MESSAGES' # 私域机器人频道消息事件，公域机器人请注释 # [!code ++]
      - 'GUILDS' # 频道变更事件 # [!code ++]
      - 'GUILD_MEMBERS' # 频道成员变更事件 # [!code ++]
      - 'GUILD_MESSAGE_REACTIONS' # 频道消息表态事件 # [!code ++]
      - 'INTERACTION' # 互动事件 # [!code ++]
      - 'PUBLIC_GUILD_MESSAGES' # 公域机器人频道消息事件，私域机器人请注释 # [!code ++]
  # 。。。其他配置项参见上方对应oneBot版本的通用配置
```
```yaml [钉钉机器人]
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
dingtalk.102007874: # `${适配器名称}:${clientid}` # [!code ++]
  versions: # [!code ++]
    - version: V11 # [!code ++]
    - version: V12 # [!code ++]
  protocol: # [!code ++]
    clientSecret: '' # 钉钉机器人秘钥 必填 # [!code ++]
    username: '钉钉机器人' #钉钉后台配置的机器人名称 不填则显示'钉钉机器人' # [!code ++]
    avatar: '' # 机器人头像 不填则显示钉钉logo # [!code ++]
# 每个账号的单独配置(用于覆盖通用配置)
```
```yaml [微信机器人]
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
wechat.bot1: # `${适配器名称}:${机器人唯一标识}` # [!code ++]
  versions: # [!code ++]
    - version: V11 # [!code ++]
    - version: V12 # [!code ++]
  protocol: {} # [!code ++]
# 每个账号的单独配置(用于覆盖通用配置)
```
:::
